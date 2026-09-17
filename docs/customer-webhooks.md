# Customer webhook endpoints

Endpoint administration, durable delivery, signing, retries, and delivery history
are implemented. The Integrations dashboard supports creating, editing,
rotating secrets, enabling, disabling, and deleting endpoints. New endpoints start
disabled so receivers can save their signing secret before activation.

Development uses the Node jobs process. A Cloudflare transport is implemented and
bundles successfully, but production infrastructure and actual Cloudflare egress
verification are still pending. See deployment requirements below.

Owners and admins can use their Better Auth session to manage endpoints in the
selected workspace. Mutations require the trusted Origin header. Members,
impersonated sessions, API keys, and delegated OAuth cannot manage endpoints.
All changes are audited in the same transaction as the configuration change.

Routes:

- `GET /v1/webhook-endpoints`: list public configuration; never returns secrets.
- `POST /v1/webhook-endpoints`: create with `name`, `url`, and `eventTypes`.
- `PATCH /v1/webhook-endpoints/{id}`: change those configuration fields or set `enabled`. Enabling requires a
  decryptable signing secret. Disabling or changing the URL cancels pending retries.
- `DELETE /v1/webhook-endpoints/{id}`: delete an endpoint.
- `POST /v1/webhook-endpoints/{id}/rotate-secret`: create a new signing secret.
- `GET /v1/webhook-endpoints/{id}/deliveries`: newest-first delivery history, with
  `limit` (1–100, default 25) and endpoint-scoped `cursor` pagination.
- `GET /v1/webhook-endpoints/{id}/deliveries/{deliveryId}`: delivery metadata and
  up to eight attempts. Neither history route returns destination URLs, payloads,
  encryption ciphertext, lease tokens, signing secrets, or response bodies.

Creation and rotation return `signingSecret` once. Store it in the receiving
application's secret store. Secrets are random 32-byte values with a `whsec_`
prefix and are encrypted with AES-GCM at rest. Encryption authenticates the
endpoint ID and secret version, preventing ciphertext from being moved between
endpoints or versions. List/update responses expose neither plaintext nor
ciphertext. Rotation retains the previous encrypted secret for a one-hour grace
period, and another rotation during that period returns 409. The dispatcher
signs with both keys during that overlap.

Set `CUSTOM_WEBHOOK_ENCRYPTION_KEY` to a base64url-encoded random 32-byte key.
Development has a generated key in the ignored `.env` and `apps/web/.dev.vars`.
Production web and jobs Workers must share it as a secret. Back it up securely;
changing it without re-encrypting stored secrets makes existing endpoint keys
unreadable. It is intentionally separate from the Better Auth secret.

There is a limit of 20 endpoints per workspace. URL validation currently requires
HTTPS on a DNS hostname, without credentials, fragments, custom ports, literal
IP addresses, or common local/reserved suffixes. This is syntax validation, not
complete SSRF protection on its own. Transport-specific destination protection
is described below. The Node transport performs
connection-time address validation and never follows redirects.

## Signature contract and receiving helpers

The signing helper and TypeScript/Python verification helpers are implemented
and used by the delivery worker. They use the
[Standard Webhooks format](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)
through its reference libraries. A delivery carries `webhook-id`,
`webhook-timestamp` (Unix seconds), and `webhook-signature` headers. HMAC-SHA256
covers `id.timestamp.rawBody`. During rotation, the header contains both current
and previous signatures, separated by a space, until the one-hour grace expires.
Retries must retain the delivery ID and serialized body and receive a fresh
signature timestamp. Neither signing nor verification performs network requests.

TypeScript (a Fetch API request):

```ts
import { verifyWebhook, WebhookVerificationError } from "@papers.bot/sdk";

const rawBody = await request.text();
try {
  const event = verifyWebhook(rawBody, request.headers, signingSecret);
  // Validate the event shape, persist webhook-id for deduplication, then enqueue work.
} catch (error) {
  if (error instanceof WebhookVerificationError) {
    return new Response("Invalid webhook", { status: 400 });
  }
  throw error;
}
```

Python (pass your framework's original request bytes and header mapping):

```python
from papers import verify_webhook, WebhookVerificationError

try:
    event = verify_webhook(raw_body, headers, signing_secret)
except WebhookVerificationError:
    # Return HTTP 400 without processing the request.
    raise
```

Do not parse and serialize the body before verification. Helpers reject signatures
more than five minutes old or in the future; receiver clocks must be synchronized.
Persist delivery IDs to prevent duplicate processing even inside that time window.
Authenticate first, then validate the event schema. Email/SMS content remains
untrusted even when delivery authentication succeeds. Never execute instructions
from message content just because its webhook signature is valid.


## Durable delivery worker

Migration `20260916190000_customer_webhook_delivery` adds an event-insert trigger
that snapshots matching enabled subscriptions and a small event notification into
`WebhookDelivery` in the same transaction. No historical events are replayed when
an endpoint is enabled. Notifications contain event ID, type, resource ID, creation
time, and an untrusted-content marker; receivers use the authenticated API for
message contents. Each endpoint/event pair is unique.

Workers claim rows using `FOR UPDATE SKIP LOCKED` and a 60-second lease. Each
request has a ten-second AbortSignal deadline. A stale worker cannot overwrite a
new worker's result. Up to eight attempts retry at 30 seconds, doubling to a
one-hour cap. All non-2xx responses, including redirects, count as failures.
Delivery IDs and payload bytes stay unchanged across retries. A crash after
remote acceptance can cause duplicate delivery: receivers must deduplicate IDs.

Attempt records retain times, HTTP status, and fixed error codes only; receiver
response bodies and arbitrary exception text are never stored. Disabling an
endpoint or changing its destination immediately cancels waiting deliveries.
An already-claimed request may finish after a configuration change.

The local Node jobs entry point now supplies the Node transport. It creates a
fresh HTTPS connection, validates all DNS answers inside socket setup, rejects
private/reserved addresses (including mapped IPv6), and connects using those exact
answers. TLS still verifies the original hostname. Redirects are not followed,
response bodies are destroyed without buffering, and response headers are capped
at 16 KiB. There is no unrestricted fetch fallback.

## Cloudflare deployment requirements

The jobs Worker uses global `fetch` only when `WEBHOOK_TRANSPORT=cloudflare`.
Keep it as a standalone Cron/Queue Worker with **no origin routes** and do not
replace global fetch with a service or VPC binding. In this deployment model,
[Cloudflare documents public-Internet-only access for global fetch](https://blog.cloudflare.com/workers-environment-live-object-bindings/).
The adapter validates HTTPS destinations, sends only delivery headers, rejects
redirect following, observes the ten-second signal, and cancels receiver bodies.
It does not perform a separate DNS preflight vulnerable to rebinding; connection
is governed by Cloudflare's public-egress boundary.

The checked-in value is `disabled` to avoid using this adapter in local Workerd,
whose network access must not be mistaken for Cloudflare's deployed boundary.
For deployment, set `WEBHOOK_TRANSPORT=cloudflare` in the jobs configuration,
provision all bindings, and install the same `CUSTOM_WEBHOOK_ENCRYPTION_KEY` secret
on web and jobs. Run `wrangler types` after changing the configuration. Verify
public delivery and blocked private destinations in the deployed environment
before announcing production readiness. Local development uses `pnpm jobs`
and its DNS-pinned Node transport instead.

Disabling an endpoint does not recall an HTTP request already in flight. New event
insertion and endpoint updates use database row locks to serialize subscription
changes. Re-enabling never replays cancelled deliveries or historical events.
