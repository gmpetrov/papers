import httpx
import pytest
from papers import Papers, AsyncPapers, PapersError


@pytest.mark.asyncio
@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("malformed", [False, True])
async def test_validation_details(asynchronous, malformed):
    issue = {"code": "invalid_format", "path": ["to", 0], "message": "Invalid email", "input": "private input"}
    if malformed:
        issue["path"] = {"private": "data"}

    def respond(request):
        return httpx.Response(400, json={"error": {
            "code": "validation_error", "message": "Check fields", "retryable": False,
            "details": [issue],
        }})

    with pytest.raises(PapersError) as caught:
        if asynchronous:
            async with AsyncPapers("fixture", transport=httpx.MockTransport(respond)) as client:
                await client.get_operation("fixture")
        else:
            with Papers("fixture", transport=httpx.MockTransport(respond)) as client:
                client.get_operation("fixture")
    assert caught.value.code == "validation_error"
    assert caught.value.details == (None if malformed else [{
        "code": "invalid_format", "path": ["to", 0], "message": "Invalid email",
    }])
    assert caught.value.retryable is False
