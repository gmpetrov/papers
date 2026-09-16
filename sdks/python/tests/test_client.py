import json
import httpx
import pytest
from papers import Papers, AsyncPapers, PapersError


def test_reply_preserves_idempotency_and_read_status():
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(200, json={"id": "operation", "status": "completed"})

    with Papers("test") as client:
        client._http.close()
        client._http = httpx.Client(
            base_url="https://example.test/v1/", transport=httpx.MockTransport(handle)
        )
        client.reply_to_email("message", text="Reply", idempotency_key="stable-key")
        client.set_message_unread("message", False)
    assert requests[0].url.path == "/v1/messages/message/reply"
    assert requests[0].headers["Idempotency-Key"] == "stable-key"
    assert json.loads(requests[0].content) == {"text": "Reply"}
    assert requests[1].method == "PATCH"
    assert json.loads(requests[1].content) == {"unread": False}


def test_errors_expose_code_and_request_id():
    with Papers("test") as client:
        client._http.close()
        client._http = httpx.Client(
            base_url="https://example.test/v1/",
            transport=httpx.MockTransport(
                lambda _: httpx.Response(
                    403,
                    json={
                        "error": {
                            "code": "insufficient_scope",
                            "message": "Missing scope",
                            "request_id": "request",
                        }
                    },
                )
            ),
        )
        with pytest.raises(PapersError) as error:
            client.capabilities()
        assert error.value.status == 403
        assert error.value.code == "insufficient_scope"
        assert error.value.request_id == "request"


@pytest.mark.asyncio
async def test_async_reply_and_pagination():
    requests = []

    def handle(request):
        requests.append(request)
        if request.method == "POST":
            return httpx.Response(202, json={"id": "operation", "status": "unknown"})
        second = request.url.params.get("cursor") == "next"
        message = {
            "id": "second" if second else "first",
            "inboxId": "inbox",
            "subject": "Test",
            "direction": "inbound",
            "status": "received",
        }
        return httpx.Response(
            200, json={"data": [message], "nextCursor": None if second else "next"}
        )

    async with AsyncPapers("test") as client:
        await client._http.aclose()
        client._http = httpx.AsyncClient(
            base_url="https://example.test/v1/", transport=httpx.MockTransport(handle)
        )
        operation = await client.reply_to_email(
            "message", text="Reply", idempotency_key="stable-key"
        )
        assert operation["status"] == "unknown"
        assert [message.id async for message in client.iter_messages("inbox")] == [
            "first",
            "second",
        ]
    assert requests[0].headers["Idempotency-Key"] == "stable-key"
    assert len(requests) == 3


@pytest.mark.asyncio
async def test_sms_models_preserve_sender_and_untrusted_content():
    payload = {
        "id": "sms",
        "phoneNumberId": "number",
        "from": "+12025550100",
        "to": "+12025550101",
        "text": "External text",
        "direction": "inbound",
        "status": "received",
        "unread": True,
        "createdAt": "2026-09-16T00:00:00Z",
        "contentTrust": "untrusted",
    }

    def handle(request):
        assert request.url.raw_path == b"/v1/sms/id%2Fescaped"
        return httpx.Response(200, json=payload)

    with Papers("test") as client:
        client._http.close()
        client._http = httpx.Client(
            base_url="https://example.test/v1/", transport=httpx.MockTransport(handle)
        )
        message = client.get_sms("id/escaped")
        assert message.from_ == payload["from"]
        assert message.contentTrust == "untrusted"
    async with AsyncPapers("test") as client:
        await client._http.aclose()
        client._http = httpx.AsyncClient(
            base_url="https://example.test/v1/", transport=httpx.MockTransport(handle)
        )
        message = await client.get_sms("id/escaped")
        assert message.to == payload["to"]
        assert message.text == payload["text"]


@pytest.mark.asyncio
async def test_workspace_phone_purchase_and_release_interfaces():
    calls = []

    def handle(request):
        calls.append(request)
        if request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "id": "number",
                    "agentId": None,
                    "phoneNumber": "+12025550101",
                    "status": "active",
                },
            )
        return httpx.Response(
            202, json={"id": "operation", "status": "pending", "numberId": "number"}
        )

    args = dict(
        phone_number="+12025550101",
        country="US",
        monthly_cost="1.00",
        upfront_cost="1.00",
        currency="USD",
        idempotency_key="buy-key",
    )
    with Papers("test") as client:
        client._http.close()
        client._http = httpx.Client(
            base_url="https://example.test/v1/", transport=httpx.MockTransport(handle)
        )
        assert client.get_phone_number("number").agentId is None
        assert client.provision_phone_number(**args)["status"] == "pending"
        client.release_phone_number("id/escaped", idempotency_key="release-key")
    async with AsyncPapers("test") as client:
        await client._http.aclose()
        client._http = httpx.AsyncClient(
            base_url="https://example.test/v1/", transport=httpx.MockTransport(handle)
        )
        assert (await client.get_phone_number("number")).agentId is None
        assert (await client.provision_phone_number(**args))["status"] == "pending"
        await client.release_phone_number("id/escaped", idempotency_key="release-key")
    for purchase in [calls[1], calls[4]]:
        assert purchase.headers["Idempotency-Key"] == "buy-key"
        assert json.loads(purchase.content) == {
            "phoneNumber": "+12025550101",
            "country": "US",
            "monthlyCost": "1.00",
            "upfrontCost": "1.00",
            "currency": "USD",
        }
    for release in [calls[2], calls[5]]:
        assert release.method == "DELETE"
        assert release.url.raw_path == b"/v1/phone-numbers/id%2Fescaped"
        assert release.headers["Idempotency-Key"] == "release-key"

@pytest.mark.parametrize("header, expected", [("17", 17), ("-1", None), ("invalid", None), ("9007199254740992", None)])
def test_retry_after_delay(header, expected):
    with Papers("test") as client:
        client._http.close()
        client._http = httpx.Client(base_url="https://example.test/v1/", transport=httpx.MockTransport(lambda _: httpx.Response(429, headers={"Retry-After": header}, json={"error": {"code": "rate_limited", "message": "Wait", "retryable": True}})))
        with pytest.raises(PapersError) as error:
            client.capabilities()
        assert error.value.retry_after_seconds == expected
        assert error.value.retryable is True
