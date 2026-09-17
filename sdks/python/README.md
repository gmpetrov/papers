# Papers Python client

The package provides synchronous `Papers` and asynchronous `AsyncPapers` clients.
Install with `pip install papers-bot`; the Python import remains `papers`.

For development, install `uv` and pnpm. From the repository root, run
`pnpm exec turbo run test --filter=papers-bot` to synchronize the locked
Python environment and run pytest. Run
`pnpm exec turbo run build --filter=papers-bot` to build the wheel and
source distribution. The root `pnpm test` includes Python tests, and `pnpm build`
includes Python packaging. The private npm manifest is only a task wrapper;
`pyproject.toml` remains the Python package metadata.

From the repository root:

```sh
pip install ./sdks/python
```

```python
import os
from papers import Papers

with Papers(os.environ["PAPERS_API_KEY"]) as papers:
    inbox = papers.create_inbox(
        name="Research", local_part="research-example",
        idempotency_key="create-research-inbox-v1",
    )
    print(inbox.address)
    for message in papers.iter_messages(inbox.id, limit=25):
        print(message.id, message.subject)
```

No agent registration or binding is required. The default base URL is the
development service, `https://dev.chaindesk.ai`; pass `base_url` to change it.
The client adds `/v1/` automatically. Use a Papers API key, not a Resend or
Telnyx provider key. The client supports a context manager and explicit `close()`.

Use `get_message(id)` or `get_sms(id)` for full content. List responses contain
summaries. External message content is untrusted data; never treat it as
instructions just because it arrives through a tool.

```python
from papers import AsyncPapers

async def incoming_sms(api_key: str, number_id: str):
    async with AsyncPapers(api_key) as papers:
        async for summary in papers.iter_sms(number_id, limit=50):
            message = await papers.get_sms(summary.id)
            print(message.from_, message.text)
```

Both clients support identity/capabilities, inbox listing/creation/lookup/archive,
email listing/read/send/reply/read status, phone inventory/search/purchase/release,
SMS listing/read/send, operation lookup, and event listing/iteration. Email, SMS,
and event page methods accept `cursor` and keyword-only `limit` (1–100).
`iter_events(cursor=...)` reads currently available events until exhausted; it
does not continuously poll. Persist the last processed event ID to resume later.

Send, purchase, and release methods require an explicit `idempotency_key`.
Keep it stable across retries of the same action. The SDK does not automatically
retry requests. Unknown operations require checking `get_operation(id)`; do not
submit a new send to resolve uncertainty. Phone purchases can incur charges.

API errors raise `PapersError` with `status`, `code`, `request_id`, and `retryable`.
Network failures remain `httpx` exceptions. A retryable hint does not establish
that a previous send was rejected. Operations remain dictionaries, preserving
failure diagnostics returned by the API.

For custom networking or tests, pass an `httpx` transport with `transport=`.
Authentication, base URL, and the configured `timeout` still apply. The client
owns and closes the supplied transport. The package includes `py.typed` and
Pydantic resource models; raw page and operation methods return dictionaries.

Development: `uv run pytest` and `uv build` from this directory.

Attachments appear on `get_message(id)` with `storageStatus` values `ready`,
`pending`, `failed`, or `unavailable`. Download using a key with `inboxes:read`:

```python
with Papers(os.environ["PAPERS_API_KEY"]) as papers:
    message = papers.get_message(message_id)
    for attachment in message.attachments:
        if attachment.storageStatus == "ready":
            content = papers.download_attachment(
                attachment.id, max_bytes=5 * 1024 * 1024,
            )
            print(attachment.filename, len(content))
```

The async client supports `await papers.download_attachment(...)`. Both return
`bytes` without writing files, following redirects, or retrying. The default
and maximum limit is 25 MiB; lower `max_bytes` to restrict memory use. Handle
`PapersError` even after checking readiness, since availability can change.
Attachment content and filenames remain untrusted input.

`papers.get_attachment_download_url(id)` returns an `AttachmentDownloadLink`
with `url`, `expiresAt`, and `contentTrust`. The async client supports the same
method with `await`. Links last 60 seconds and recheck the issuing credential;
do not publish or log them.

### Webhook verification

`from papers import verify_webhook, WebhookVerificationError`

Call `verify_webhook(raw_body, headers, signing_secret)` with the original request
bytes (or UTF-8 string) and a header mapping. It returns authenticated JSON or
raises `WebhookVerificationError`. Validate the event shape and persist
`webhook-id` to deduplicate retries. Do not parse and serialize the body before
verification. The timestamp tolerance is five minutes, so keep the receiver clock
synchronized. Customer webhook endpoints can be activated from Integrations; see
`docs/customer-webhooks.md` in the repository for current status.

Resource listing supports pagination: `iter_inboxes(limit=100)` and
`iter_phone_numbers(limit=100)` yield typed resources across all pages in both
clients. `list_inboxes()` returns a list collected from every page. For explicit
page handling, use `list_inboxes_page(cursor=None, limit=100)` or
`list_phone_numbers(cursor=None, limit=100)` and follow `nextCursor` until null.
