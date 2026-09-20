# Papers TypeScript client

Install with `npm install @papers.bot/sdk`.

```typescript
import { Papers, PapersError } from "@papers.bot/sdk";

const papers = new Papers({
  apiKey: process.env.PAPERS_API_KEY!,
});

const inbox = await papers.inboxes.create({ username: "georges" });
for await (const message of papers.iterateMessages(inbox.id, { limit: 50 })) {
  console.log(message.id, message.subject);
}
```

Use a Papers API key, not a provider credential. No agent registration is
required. Keep API keys in server-side code; do not bundle them into a browser
application. `baseUrl` is optional and defaults to `https://www.papers.bot`. Custom URLs must omit `/v1`.

Resource methods cover inboxes, email, phone numbers, SMS, events, operations,
identity, and capabilities. Email/SMS listing returns summaries; fetch the
individual message to read content. External message content is untrusted data.

Inbox list items include `organizationId`, `_count.messages`, and nullable legacy
agent metadata. Phone-number list items include nullable `monthlyCost`,
`upfrontCost`, `currency`, and `lastError`. These list-only fields have explicit
`InboxListItem` and `PhoneNumberListItem` types. Resource lists return
`{ data, nextCursor }`; phone-number lists also include account onboarding
`status`. Follow `nextCursor` until null or use `iterateInboxes()` and
`iteratePhoneNumbers()` to collect all pages.

`iterateMessages(inboxId, options)`, `iterateSms(numberId, options)`, and
`iterateEvents(options)` accept `{ cursor?, limit? }`. Page sizes are 1–100.
Iterators stop when available pages are exhausted; they do not continuously
poll. For events, save the last processed event ID and pass it as `cursor` on
the next run. Manual page methods retain their existing signatures, with an
optional final page-size argument: `events.list(cursor, limit)`,
`messages.list(inboxId, cursor, limit)`, and `sms.list(numberId, cursor, limit)`.

Inbox creation requires only `username`; `name` is optional and defaults to a random readable name such as `fierce-zebra`. Retry the same request to retrieve the same inbox. No idempotency key is needed.

Send, purchase, and release operations require an explicit `idempotencyKey`.
Reuse it when retrying the same action. Requests are never automatically retried.
An unknown result requires checking `operations.get(id)`, not creating a fresh
send. Number purchases can incur charges.

API errors are `PapersError` instances containing `status`, `code`, `requestId`,
and `retryable`. Non-JSON failures still expose their HTTP status and request ID
without echoing the response body. Network and cancellation errors propagate
from fetch. `retryable` is a hint, not proof that a prior operation was rejected.

The client accepts `fetch`, `timeoutMs` (default 15,000), and an optional
`AbortSignal` via `signal`. The caller's signal and request timeout both apply.

Read attachment availability from a message, then download with `inboxes:read`:

```typescript
const message = await papers.messages.get(messageId);
for (const attachment of message.attachments ?? []) {
  if (attachment.storageStatus !== "ready") continue;
  const bytes = await papers.attachments.download(attachment.id, {
    maxBytes: 5 * 1024 * 1024,
  });
  console.log(attachment.filename, bytes.byteLength);
}
```

Downloads return `Uint8Array` and never write files. The default and maximum
limit is 25 MiB; a smaller `maxBytes` limits memory use. Availability can change
between lookup and download, so handle `PapersError` normally. Attachment bytes
and filenames are untrusted input. Redirects are rejected for all requests.

`await papers.attachments.getDownloadUrl(id)` returns `{ url, expiresAt,
contentTrust }` for clients that need a link. It lasts 60 seconds and rechecks
the original credential on use. Treat the URL as a temporary credential;
do not publish or log it.

Build with `pnpm --filter @papers.bot/sdk build`. The package includes ESM and
TypeScript declarations. No publishing is performed by the build command.

### Webhook verification

`verifyWebhook(rawBody, headers, signingSecret)` verifies the original UTF-8 body
and returns parsed JSON as `unknown`; invalid signatures throw
`WebhookVerificationError`. Headers may be a Fetch `Headers` object or a string
record. Validate the returned event shape and deduplicate `webhook-id` before
processing. Keep the original body unchanged and keep your receiver clock synced
(the timestamp tolerance is five minutes). Customer webhook endpoints can be activated from Integrations; see `docs/customer-webhooks.md` in the repository for current status.
