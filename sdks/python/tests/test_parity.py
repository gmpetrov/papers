import httpx
import pytest
from papers import AsyncPapers, Papers, PapersError


@pytest.mark.asyncio
async def test_sync_async_identity_inboxes_and_events():
    calls = []

    def handle(request):
        calls.append(request)
        assert request.headers["Authorization"] == "Bearer test-secret"
        path = request.url.path
        if path.endswith("/me"):
            return httpx.Response(200, json={"organizationId": "workspace"})
        if path.endswith("/events"):
            assert request.url.params["limit"] == "2"
            cursor = request.url.params.get("cursor")
            if cursor == "second":
                return httpx.Response(200, json={"data": [], "nextCursor": None})
            item_id = "first" if not cursor else "second"
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "id": item_id,
                            "type": "email.received",
                            "resourceId": "message",
                            "agentId": None,
                            "createdAt": "2026-09-16T00:00:00Z",
                        }
                    ],
                    "nextCursor": item_id,
                },
            )
        assert request.url.raw_path == b"/v1/inboxes/inbox%2Fid"
        if request.method == "PATCH":
            assert request.content == b'{"status":"archived"}'
            return httpx.Response(200, json={"status": "archived"})
        return httpx.Response(
            200,
            json={
                "id": "inbox/id",
                "name": "Inbox",
                "address": "test@example.test",
                "status": "active",
            },
        )

    with Papers(
        "test-secret",
        base_url="https://example.test",
        transport=httpx.MockTransport(handle),
    ) as client:
        assert client.me()["organizationId"] == "workspace"
        assert client.get_inbox("inbox/id").agentId is None
        assert client.archive_inbox("inbox/id")["status"] == "archived"
        assert [e.id for e in client.iter_events(limit=2)] == ["first", "second"]
    async with AsyncPapers(
        "test-secret",
        base_url="https://example.test",
        transport=httpx.MockTransport(handle),
    ) as client:
        assert (await client.me())["organizationId"] == "workspace"
        assert (await client.get_inbox("inbox/id")).agentId is None
        assert (await client.archive_inbox("inbox/id"))["status"] == "archived"
        assert [e.id async for e in client.iter_events(limit=2)] == ["first", "second"]
    assert len(calls) == 12


@pytest.mark.asyncio
async def test_sms_pagination_and_email_content_trust():
    def handle(request):
        if request.url.path.startswith("/v1/messages/"):
            return httpx.Response(
                200,
                json={
                    "id": "email",
                    "inboxId": "inbox",
                    "subject": "External",
                    "from": "sender@example.test",
                    "to": ["test@example.test"],
                    "replyTo": ["reply@example.test"],
                    "direction": "inbound",
                    "status": "received",
                    "contentTrust": "untrusted",
                },
            )
        assert request.url.params["limit"] == "1"
        second = request.url.params.get("cursor") == "first"
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "second" if second else "first",
                        "phoneNumberId": "number",
                        "from": "+12025550100",
                        "to": "+12025550101",
                        "direction": "inbound",
                        "status": "received",
                        "unread": True,
                        "createdAt": "2026-09-16T00:00:00Z",
                    }
                ],
                "nextCursor": None if second else "first",
            },
        )

    with Papers("test", transport=httpx.MockTransport(handle)) as client:
        assert [m.id for m in client.iter_sms("number", limit=1)] == ["first", "second"]
        email = client.get_message("email")
        assert email.from_ == "sender@example.test"
        assert email.contentTrust == "untrusted"
        assert email.replyTo == ["reply@example.test"]
    async with AsyncPapers("test", transport=httpx.MockTransport(handle)) as client:
        assert [m.id async for m in client.iter_sms("number", limit=1)] == [
            "first",
            "second",
        ]
        assert (await client.get_message("email")).contentTrust == "untrusted"


@pytest.mark.parametrize(
    "status,payload,code",
    [
        (502, "<html>private provider error</html>", "http_error"),
        (200, "not json", "invalid_response"),
        (200, "[]", "invalid_response"),
        (401, '{"error":"unauthorized"}', "http_error"),
    ],
)
@pytest.mark.asyncio
async def test_non_json_and_malformed_responses_are_safe(status, payload, code):
    def handle(_):
        return httpx.Response(status, text=payload, headers={"X-Request-Id": "trace"})

    with Papers("test", transport=httpx.MockTransport(handle)) as client:
        with pytest.raises(PapersError) as error:
            client.capabilities()
        assert error.value.code == code
        assert error.value.status == status
        assert error.value.request_id == "trace"
        assert "private" not in str(error.value)
    async with AsyncPapers("test", transport=httpx.MockTransport(handle)) as client:
        with pytest.raises(PapersError) as error:
            await client.capabilities()
        assert error.value.code == code


def test_retryable_hint_does_not_automatically_repeat_sends():
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(
            503,
            json={
                "error": {
                    "code": "unavailable",
                    "message": "Unavailable",
                    "retryable": True,
                }
            },
        )

    with Papers("test", transport=httpx.MockTransport(handle)) as client:
        with pytest.raises(PapersError) as error:
            client.send_email(
                "inbox",
                to=["test@example.test"],
                subject="Test",
                text="Hello",
                idempotency_key="stable-key",
            )
        assert error.value.retryable is True
        assert len(calls) == 1
        assert calls[0].headers["Idempotency-Key"] == "stable-key"


@pytest.mark.parametrize("limit", [0, 101, -1, 1.5, True])
def test_invalid_page_sizes_do_not_make_requests(limit):
    def handle(_):
        pytest.fail("Invalid pagination must not make a request")

    with Papers("test", transport=httpx.MockTransport(handle)) as client:
        with pytest.raises(ValueError):
            client.list_events(limit=limit)


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["inboxes", "numbers"])
async def test_resource_pagination_sync_async(kind):
    calls = []

    def handle(request):
        calls.append(request)
        cursor = request.url.params.get("cursor")
        assert request.url.params["limit"] == "2"
        assert cursor in (None, "next/+&")
        item = {"id": "second" if cursor else "first", "status": "active"}
        if kind == "inboxes":
            item.update(name="Research", address="research@example.test")
        else:
            item.update(phoneNumber="+12025550100")
        return httpx.Response(200, json={"data": [item], "nextCursor": None if cursor else "next/+&"})

    with Papers("test", transport=httpx.MockTransport(handle)) as client:
        iterator = client.iter_inboxes(limit=2) if kind == "inboxes" else client.iter_phone_numbers(limit=2)
        assert [item.id for item in iterator] == ["first", "second"]
    async with AsyncPapers("test", transport=httpx.MockTransport(handle)) as client:
        iterator = client.iter_inboxes(limit=2) if kind == "inboxes" else client.iter_phone_numbers(limit=2)
        assert [item.id async for item in iterator] == ["first", "second"]
    assert len(calls) == 4
    assert all(request.url.path == ("/v1/inboxes" if kind == "inboxes" else "/v1/phone-numbers") for request in calls)
