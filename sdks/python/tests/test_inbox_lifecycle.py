import json
import httpx
import pytest
from papers import Papers, AsyncPapers


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
