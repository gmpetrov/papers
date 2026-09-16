# Private email attachments

The core storage worker (`processAttachments`) retrieves attachment metadata
through Resend's receiving API, downloads the bytes, writes them to a private
R2-compatible binding, and records the object key only after storage succeeds.
Objects use workspace/message/attachment IDs, never external filenames.

Downloads accept only HTTPS URLs on `inbound-cdn.resend.com`, with no credentials
or custom port. Redirects are rejected. Provider credentials are sent only by
the Resend API client, never to the download URL. Each file is limited to 25 MiB;
both metadata and actual streamed length are checked. Objects are stored and
served as `application/octet-stream` with forced download and no-sniff headers.
No attachment is rendered as HTML by this implementation.

Attachment work is independent of message ingestion. Failures preserve the
message and metadata. Database claims last five minutes; retries start after
30 seconds with exponential backoff, up to eight attempts. The worker stores
fixed error codes rather than URLs, signatures, or raw exception messages.
Oversized files remain unavailable and are subject to the same attempt bound.
Operators can investigate `storageError` and reset `storageAttempts` and
`nextStorageAttemptAt` after fixing the cause. A lost database confirmation
after a successful object write retries the same deterministic key.

`GET /v1/attachments/{id}/download` requires `inboxes:read` and current access to
the message's workspace and, for legacy bound keys, its inbox's agent. It checks
authorization on every request, including key revocation. Successful access is
audited. Pending storage returns 409; missing storage configuration returns 503.
The endpoint never returns a provider download URL or a private object key.

The web runtime and local background worker share the `ATTACHMENTS` R2 binding.
Next.js development and the jobs process persist local R2 objects under the
repository's ignored `.wrangler/shared` directory. Run `pnpm dev` and `pnpm jobs`
from the repository root. This local storage is a Cloudflare emulator; it does
not upload files to a production R2 bucket. The Worker configuration names the
private `papers-attachments` bucket, which must be created before production
deployment. The [scheduled background Worker](background-workers.md) includes
attachment processing and has passed local runtime checks; production deployment
is still outstanding.

`scripts/attachment-runtime-check.ts` writes a temporary object through a
separate Wrangler proxy, creates a fixture in the test user's development
workspace, downloads it through the authenticated public development tunnel,
checks anonymous rejection, and removes the fixture. Run it with
`pnpm exec dotenv -e .env -- tsx scripts/attachment-runtime-check.ts`.
It requires `.env.e2e`, sends no email, and does not alter actual messages.

The message detail API includes attachment `storageStatus` (`ready`, `pending`,
`failed`, or `unavailable`) without exposing object keys or internal retry state.
The dashboard displays these states and lets users refresh availability and
download ready files. Download failures appear inline without navigating away
from the message. Filenames are rendered as text; the browser never previews
attachment HTML in the dashboard. The runtime check also verifies these UI
behaviors and checks the actual downloaded bytes.

Both SDKs expose attachment metadata on message details and authenticated binary
downloads: TypeScript `papers.attachments.download(id, { maxBytes })` returns a
`Uint8Array`; Python `papers.download_attachment(id, max_bytes=...)` returns
`bytes` in both synchronous and asynchronous clients. Downloads default to a
25 MiB limit and allow callers to lower it. They reject oversized streams even
without a Content-Length header, do not follow redirects, and do not retry.
Neither helper writes files or interprets attachment contents.

Both remote MCP and the CLI stdio adapter expose `download_attachment` with
`attachmentId` and optional `maxBytes`. The default is 1 MiB; callers may
explicitly request up to 25 MiB. The tool uses the same authenticated download
endpoint and `inboxes:read` permission and returns an embedded binary resource
with base64 bytes and `application/octet-stream`. Its `papers://` URI identifies
the returned resource; it is not a public download link. No external filename
or content is executed or rendered by the server. MCP hosts determine how to
handle binary resources, so actual Claude/ChatGPT/Grok presentation still needs
client-specific verification. The CLI also supports downloading directly to a
new local file via `attachments download ID --output PATH`.

The resource format follows the [MCP embedded-resource schema](https://modelcontextprotocol.io/specification/2025-11-25/schema).

`POST /v1/attachments/{id}/download-url` issues a link valid for 60 seconds after
checking current attachment access and storage readiness. The response includes
`url`, `expiresAt`, and `contentTrust: "untrusted"`. Redeem the URL without an
Authorization header. Its signature binds the attachment, workspace, original
credential reference, audience, and expiry; it contains no provider URL, object
key, or raw credential. The server uses a purpose-prefixed HMAC signed with the
Better Auth secret, so rotating that secret also invalidates outstanding links.

Redemption rechecks the original API key, OAuth grant, or session using the
current database state, including expiry, revocation, scope, and membership.
OAuth links retain the original `/mcp` or `/v1` audience checks even when redeemed
at the REST content route. Session links stop working on logout or a change of
active workspace. A link can be used repeatedly until it expires, but it grants
access to anyone holding it while valid: do not log or publish the full URL.
Responses force download, disable caching, and set `Referrer-Policy: no-referrer`.

TypeScript exposes `attachments.getDownloadUrl(id)`, Python exposes
`get_attachment_download_url(id)` (sync and async), and MCP exposes
`get_attachment_download_url`. Use binary download helpers when no link is
needed. The runtime check verifies MCP link creation, anonymous redemption,
permission removal, and revoked-key rejection through the development tunnel.

References: [Resend attachment retrieval](https://resend.com/docs/api-reference/emails/retrieve-received-email-attachment)
and [Cloudflare R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).
