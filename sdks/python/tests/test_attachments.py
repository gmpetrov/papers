import httpx
import pytest
from papers import Papers, AsyncPapers, PapersError, Message


@pytest.mark.asyncio
async def test_binary_downloads_preserve_bytes_and_authentication():
    content = bytes([0, 255, 128, 10])

    def handle(request):
        assert request.url.raw_path == b"/v1/attachments/file%2Fid/download"
        assert request.headers["Authorization"] == "Bearer test"
        return httpx.Response(
            200, content=content, headers={"Content-Type": "application/octet-stream"}
        )

    with Papers("test", transport=httpx.MockTransport(handle)) as client:
        assert client.download_attachment("file/id") == content
    async with AsyncPapers("test", transport=httpx.MockTransport(handle)) as client:
        assert await client.download_attachment("file/id") == content


@pytest.mark.asyncio
async def test_stream_limits_work_without_content_length():
    def handle(_):
        return httpx.Response(
            200,
            stream=httpx.ByteStream(b"123"),
            headers={"Content-Type": "application/octet-stream"},
        )

    with Papers("test", transport=httpx.MockTransport(handle)) as client:
        with pytest.raises(PapersError) as error:
            client.download_attachment("file", max_bytes=2)
        assert error.value.code == "attachment_too_large"
    async with AsyncPapers("test", transport=httpx.MockTransport(handle)) as client:
        with pytest.raises(PapersError) as error:
            await client.download_attachment("file", max_bytes=2)
        assert error.value.code == "attachment_too_large"


@pytest.mark.parametrize("status", [401, 409, 503])
@pytest.mark.asyncio
async def test_download_errors_keep_status_and_do_not_retry(status):
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(
            status,
            json={
                "error": {
                    "code": "attachment_not_ready",
                    "message": "Not ready",
                    "request_id": "trace",
                }
            },
        )

    with Papers("test", transport=httpx.MockTransport(handle)) as client:
        with pytest.raises(PapersError) as error:
            client.download_attachment("file")
        assert error.value.status == status
        assert error.value.request_id == "trace"
    async with AsyncPapers("test", transport=httpx.MockTransport(handle)) as client:
        with pytest.raises(PapersError) as error:
            await client.download_attachment("file")
        assert error.value.code == "attachment_not_ready"
    assert len(calls) == 2


def test_attachment_metadata_and_empty_files():
    message = Message.model_validate(
        {
            "id": "message",
            "inboxId": "inbox",
            "subject": "Test",
            "direction": "inbound",
            "status": "received",
            "attachments": [
                {
                    "id": "file",
                    "filename": "test.txt",
                    "contentType": "text/plain",
                    "size": 0,
                    "storageStatus": "ready",
                }
            ],
        }
    )
    assert message.attachments[0].storageStatus == "ready"
    with Papers(
        "test",
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200, content=b"", headers={"Content-Type": "application/octet-stream"}
            )
        ),
    ) as client:
        assert client.download_attachment("file", max_bytes=0) == b""
        with pytest.raises(ValueError):
            client.download_attachment("file", max_bytes=-1)

@pytest.mark.asyncio
async def test_outgoing_files_in_email_reply_and_sms():
    import json
    files = [{"filename": "photo.png", "contentType": "image/png", "content": "AAE="}]
    calls = []
    def handle(request):
        assert json.loads(request.content)["attachments"] == files
        calls.append(request)
        return httpx.Response(200, json={"id": "op", "status": "completed"})
    with Papers("test", transport=httpx.MockTransport(handle)) as client:
        client.send_email("inbox", to=["a@example.test"], subject="Files", text="Hi", idempotency_key="same", attachments=files)
        client.reply_to_email("message", text="Hi", idempotency_key="same", attachments=files)
        client.send_sms("phone", to="+12025550100", text="Hi", idempotency_key="same", attachments=files)
    async with AsyncPapers("test", transport=httpx.MockTransport(handle)) as client:
        await client.send_email("inbox", to=["a@example.test"], subject="Files", text="Hi", idempotency_key="same", attachments=files)
        await client.reply_to_email("message", text="Hi", idempotency_key="same", attachments=files)
        await client.send_sms("phone", to="+12025550100", text="Hi", idempotency_key="same", attachments=files)
    assert len(calls) == 6
