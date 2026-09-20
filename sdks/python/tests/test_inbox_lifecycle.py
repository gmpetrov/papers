import json
import httpx
import pytest
from papers import Papers, AsyncPapers


@pytest.mark.asyncio
@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("name", [None, "Research"])
async def test_create_with_username_and_optional_name(asynchronous, name):
    def respond(request):
        assert request.method == "POST"
        assert request.url.path.endswith("/inboxes")
        assert "Idempotency-Key" not in request.headers
        assert json.loads(request.content) == {
            "username": "research",
            **({"name": name} if name is not None else {}),
        }
        return httpx.Response(201, json={
            "id": "inbox", "name": name or "fierce-zebra",
            "address": "research@example.test", "status": "active",
        })
    args = {"username": "research", **({"name": name} if name is not None else {})}
    if asynchronous:
        async with AsyncPapers("fixture", transport=httpx.MockTransport(respond)) as client:
            inbox = await client.create_inbox(**args)
    else:
        with Papers("fixture", transport=httpx.MockTransport(respond)) as client:
            inbox = client.create_inbox(**args)
    assert inbox.name == (name or "fierce-zebra")


@pytest.mark.asyncio
@pytest.mark.parametrize("asynchronous", [False, True])
async def test_archive_and_reactivate(asynchronous):
    seen = []
    def respond(request):
        assert request.method == "PATCH"
        assert request.url.raw_path.endswith(b"inboxes/inbox%2Fid")
        body = json.loads(request.content)
        seen.append(body["status"])
        return httpx.Response(200, json=body)
    if asynchronous:
        async with AsyncPapers("fixture", transport=httpx.MockTransport(respond)) as client:
            assert await client.archive_inbox("inbox/id") == {"status": "archived"}
            assert await client.reactivate_inbox("inbox/id") == {"status": "active"}
    else:
        with Papers("fixture", transport=httpx.MockTransport(respond)) as client:
            assert client.archive_inbox("inbox/id") == {"status": "archived"}
            assert client.reactivate_inbox("inbox/id") == {"status": "active"}
    assert seen == ["archived", "active"]
