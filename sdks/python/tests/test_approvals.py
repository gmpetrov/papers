import httpx
import pytest
from papers import Papers, AsyncPapers, PapersError


def response(request):
    if request.url.path.endswith("/approvals"):
        assert request.url.params["cursor"] == "older/+"
        assert request.url.params["limit"] == "10"
        return httpx.Response(200, json={"data": [], "policyVersion": 1})
    return httpx.Response(409, json={"error": {"code": "approval_required", "message": "Review required", "details": {"approvalId": "approval", "extra": "not exposed"}}})


def test_list_and_preserve_approval_id():
    with Papers("fixture", transport=httpx.MockTransport(response)) as client:
        assert client.list_approvals("older/+", limit=10) == {"data": [], "policyVersion": 1}
        with pytest.raises(PapersError) as caught:
            client.get_operation("fixture")
        assert caught.value.details == {"approvalId": "approval"}


@pytest.mark.asyncio
async def test_async_list_and_preserve_approval_id():
    async with AsyncPapers("fixture", transport=httpx.MockTransport(response)) as client:
        assert await client.list_approvals("older/+", limit=10) == {"data": [], "policyVersion": 1}
        with pytest.raises(PapersError) as caught:
            await client.get_operation("fixture")
        assert caught.value.details == {"approvalId": "approval"}
