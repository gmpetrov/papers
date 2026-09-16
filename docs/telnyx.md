# Telnyx integration

The account is approved. The local development configuration now uses `TELNYX_STATUS=active`, the account API key, the Ed25519 public key retrieved through `/v2/public_key`, and the `Papers development` messaging profile. Its enabled API v2 webhook is `https://dev.chaindesk.ai/api/webhooks/telnyx`. The profile currently permits US and French destinations. Additional destinations can be configured in Telnyx. Provider credentials stay server-side.

## Configuration and execution

### Register the incoming SMS webhook

In the Telnyx Portal, open Messaging → Programmable Messaging, select the
`Papers development` messaging profile, and set its inbound webhook URL to
`https://dev.chaindesk.ai/api/webhooks/telnyx`. Use API v2 and ensure the
receiving number is assigned to this messaging profile. The development
profile is already configured; registering a separate webhook per inbox or
agent is unnecessary.

For another environment, update its messaging profile through the API with
environment variables loaded in your shell:

```sh
curl --fail-with-body --request PATCH \
  "https://api.telnyx.com/v2/messaging_profiles/${TELNYX_MESSAGING_PROFILE_ID}" \
  --header "Authorization: Bearer ${TELNYX_API_KEY}" \
  --header 'Content-Type: application/json' \
  --data '{"webhook_url":"https://YOUR_DOMAIN/api/webhooks/telnyx"}'
```

Replace `YOUR_DOMAIN` with that environment's public hostname. See Telnyx's
[incoming message setup](https://developers.telnyx.com/docs/messaging/messages/receive-message).
An unsigned manual POST is expected to fail signature verification; it does
not test real delivery. Keep the tunnel, web server, and jobs process running
for development reception.

On September 16, 2026, a fresh read of the live profile confirmed it was enabled
with this URL and API version 2. The development database contained one active
assigned number and one received SMS whose provider message ID matched a
completed incoming webhook record. The current automated suite passed all
211 tests. These checks did not send an SMS or prove outbound delivery.

Set `TELNYX_API_KEY`, `TELNYX_STATUS=active`, `TELNYX_PUBLIC_KEY`, and `TELNYX_MESSAGING_PROFILE_ID` in each environment. Apply Prisma migrations, regenerate clients, and restart both web and jobs processes. The web app derives the per-message callback URL from `BETTER_AUTH_URL`; optionally override it with `TELNYX_WEBHOOK_URL` for an alternate public webhook origin. This must point to the same signature-verifying endpoint. Run `pnpm jobs` alongside the development server: it processes signed inbound/delivery events and reconciles pending number purchases and releases. Production hosting still needs a continuously running or scheduled equivalent; local jobs are not a Cloudflare deployment.

New numbers belong directly to their organization. No agent record is required. Legacy agent-linked numbers retain their access and recipient restrictions. Organizations default to five pending/active phone assignments and 100 SMS API submissions per UTC day. Quotas are checked transactionally; unknown or failed sends retain their quota reservation. These counters measure API submissions, not billable SMS segments.

## Number lifecycle

- `GET /v1/phone-numbers/available?country=US` requires `numbers:read` and returns SMS-capable inventory with current upfront/monthly prices and currency.
- `POST /v1/phone-numbers` requires `numbers:provision` and an `Idempotency-Key`. Body: `{ "phoneNumber": "+1...", "country": "US", "monthlyCost": "1.00000", "upfrontCost": "1.00000", "currency": "USD" }`. Supply actual search prices, not these examples. The server checks the exact number and price before submitting the purchase.
- Price comparison is exact decimal-string comparison: equivalent spellings such as `1.00` and `01.000` match, while distinct prices never match through floating-point rounding or overflow. A changed upfront price, monthly rental, or currency fails the operation with `price_changed` before placing an order.
- A purchase reserves a workspace slot before the provider request and returns an operation ID. Poll `GET /v1/operations/{id}`. The worker resolves the order, confirms ownership, verifies messaging-profile assignment, then marks the number active. Orders needing provider documents show `awaiting_requirements`; complete their requirements in Telnyx. The first release does not collect regulatory documents itself.
- Lost purchase responses are reconciled by the operation's unique Telnyx customer reference. The worker never repeats a purchase. Unresolved orders stay unknown. Definitively failed purchases can be retried with a new idempotency key after reviewing inventory and price again.
- `DELETE /v1/phone-numbers/{id}` requires `numbers:release` and an `Idempotency-Key`. Only active numbers can be released. The dashboard requires the number to be typed before release. The app stops new sends as soon as release starts, and preserves message history. An ambiguous delete is checked against provider ownership without repeating the delete.
- Released number records are retained and cannot be reassigned through this version of the application, preventing historical messages from crossing workspace boundaries.

Only owner/admin sessions or explicitly scoped credentials can purchase, release, or send. Impersonated sessions cannot purchase or release. New dashboard keys exclude purchase/release permissions unless selected explicitly; existing keys/OAuth grants do not gain scopes automatically.

## SMS

The development profile now has `alpha_sender=Papers` for international A2P
fallback. A live test after setting it was rejected with HTTP 403 / Telnyx
`20014` (account unverified). The portal confirms Level 1 complete and identity
accepted, but Level 2 incomplete; it explicitly requires Level 2 for international
alphanumeric messaging. Outbound delivery remains blocked until that verification
is completed. A subsequent authorized test after the user completed Level 2
verification succeeded on September 16 at 15:17:36 UTC: Telnyx reported
`delivered` to the French recipient on Bouygues Telecom, with no delivery errors
(message ID `4031a0aa-cb6d-469e-9f5a-ce6e7e502020`). This verifies the provider
route directly; it was not an end-to-end dashboard send.
Alphanumeric sends display the sender name rather than the US
phone number.

Telnyx HTTP 409 with only code `40306` (missing alpha sender) is now treated as
a definitive failed send, with actionable dashboard diagnostics. Other HTTP 409
responses remain unknown to avoid unsafe resends. Error `20014` also displays
verification guidance. Historical operations without saved evidence are not
reclassified.

The background worker also recovers local confirmation failures when the HTTP
response already supplied a valid Telnyx message ID and that ID was saved on
the operation with `failure.kind=confirmation_failed`. After a one-minute
delay, `reconcileSmsSends` retries only the database confirmation, under the
same operation lock used by HTTP and webhooks. It never calls Telnyx or sends
again. Concurrent workers emit acceptance once, preserve terminal delivery
states, and reject conflicting IDs. Conflicts are left unknown and checked at
most once per minute. Timeouts without saved acceptance evidence are excluded;
they still need a matching webhook or provider investigation. Completion here
means provider acceptance, not recipient delivery.

`POST /v1/phone-numbers/{id}/messages`, body `{ "to": "+1...", "text": "Hello" }`, requires `sms:send` and an `Idempotency-Key`. Only active assigned numbers can send. Provider acceptance completes the send operation; it does not mean recipient delivery. Definitive rejection marks it failed. Timeouts remain unknown until provider evidence arrives and are never automatically resent. Each new send includes a per-message webhook URL tied to the saved operation. The signed event body must contain that exact URL and matching sender, recipient, text, and profile before it can attach a missing provider ID and complete the operation. Transport query parameters alone cannot correlate a message. Webhook and HTTP confirmation share a lock, preserve final delivery state, and emit acceptance once. Legacy sends without a saved callback URL, or sends for which no confirming webhook arrives, remain unknown and require provider-log investigation; provider SMS idempotency is not assumed.

Failed or uncertain sends now include structured `failure` diagnostics in the send response and operation-status endpoint: failure kind, HTTP status when known, and a bounded list of numeric Telnyx codes. Raw provider response bodies, exception messages, and internal callback metadata are not returned. The dashboard shows these diagnostics, and resolved operations no longer present them as current failures. Older operations cannot gain diagnostics that were never captured. A September 16 read-only detail-record search returned no outbound records for the unresolved legacy send; absence of a record was not treated as proof of rejection.

Read assigned numbers with `numbers:read`. Read SMS summaries at `/v1/phone-numbers/{id}/messages` and bodies at `/v1/sms/{id}` with `sms:read`. Bodies are plain-text, marked `contentTrust: untrusted`, and reads are audited. MMS attachments and voice are not implemented.

Inbound events require a valid Ed25519 signature over `timestamp|raw_body` with a five-minute timestamp tolerance. Events are durably stored before acknowledgment, processed with leases/retries, and dead-lettered after exhausted attempts. Inbound routing requires an active assigned number and matching messaging profile. Duplicate events/messages are deduplicated. Outbound events match provider message ID, sender, recipient, and profile and do not regress on older delivery timestamps.

Account approval does not replace carrier-specific registration (for example US 10DLC or toll-free verification). Check the number's messaging eligibility in Telnyx before a live outbound test. The application shows provider rejection/delivery state rather than claiming all purchased numbers can immediately deliver everywhere.

## Developer interfaces

- TypeScript: `numbers.search`, `numbers.provision`, `numbers.release`, `sms.send`, `sms.list`, `sms.get`.
- Python, sync and async: `search_phone_numbers`, `provision_phone_number`, `release_phone_number`, `send_sms`, `list_sms`, `get_sms`.
- CLI: `papers numbers search`, `numbers buy`, `numbers release --confirm`, `sms send/list/get`, `operations wait`.
- MCP: `search_phone_numbers`, `provision_phone_number`, `release_phone_number`, `send_sms`, `list_sms`, `get_sms`.
- REST schemas and examples: `/openapi.json` and `/llms.txt`.

## Verification

Automated database/provider tests cover workspace and legacy-agent isolation, permissions, quotas, duplicate concurrent purchases, changed prices, delayed order recovery, regulatory-pending states, release recovery, signed webhooks, delivery ordering, workspace SMS sending, lost-response SMS recovery, and webhook/HTTP confirmation races. `node scripts/phone-browser-check.mjs` uses mocked provider-facing app endpoints to test the dashboard without charges. `node scripts/telnyx-live-check.mjs` verifies real inventory search, active configuration, and rejection of unsigned webhook requests without buying or sending.

As of September 16, 2026, live profile configuration and inventory/exact-number search are verified. A subsequent read of the development database confirmed an active number and a received inbound SMS with a completed Telnyx event. One existing outbound message remains pending; recipient delivery is not verified. The new signed-callback recovery path is verified with cryptographically signed fixtures and applies to sends created after this update. No SMS was sent or retried by this recovery implementation work.

Sources: [number search](https://developers.telnyx.com/api-reference/phone-number-search/list-available-phone-numbers), [number orders](https://developers.telnyx.com/api-reference/phone-number-orders/create-a-number-order), [messaging configuration](https://developers.telnyx.com/docs/messaging/messages/phone-number-configuration), [signed webhooks](https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks).

## SMS usage metadata

SMS list/detail responses and both SDK models include `segments`, `costAmount`,
and `costCurrency`. The SMS detail panel displays these values. Unknown provider
values remain `null` and appear as “Not reported”; a reported zero is preserved.
Amounts are decimal strings, stored as PostgreSQL decimals without floating-point
conversion. These are provider costs, not Papers subscription charges.

Signed `message.received` callbacks supply inbound usage; outbound costs are taken
from `message.finalized`, not preliminary sent callbacks. Segment and cost updates
have separate provider timestamps, so older events cannot overwrite newer values
and a later missing cost cannot erase a known value. Duplicate events do not add
charges. Invalid usage metadata is ignored without discarding the SMS itself.
Existing messages remain unknown until a suitable provider callback arrives;
there is no historical cost backfill or invoice reconciliation yet.

Telnyx documents asynchronous cost availability in its
[message detail record guide](https://developers.telnyx.com/docs/messaging/messages/message-detail-records).

## Local SMS opt-out enforcement

Verified inbound SMS callbacks with `autoresponse_type: STOP` or `START` update
provider profile/recipient state. This follows Telnyx's
[profile-level opt-out behavior](https://developers.telnyx.com/docs/messaging/messages/advanced-opt-in-out).
A known active receiving number must match the callback's profile. Ordinary text,
HELP, unknown response types, outbound events, and unmatched numbers cannot clear
a block. No automatic reply is sent by Papers.

The latest provider event time wins; STOP wins tied timestamps. The profile state
is shared across numbers and workspaces using the same provider profile, matching
Telnyx's scope. It is internal provider state, not a tenant-readable contact list.
New sends return `403 recipient_opted_out` before approvals, quota reservation,
or provider calls. Replaying an already-created operation still returns that
operation and never sends again. Human approval cannot bypass a block.

This records callbacks processed after this migration. Existing provider blocks
can be imported using the maintenance command below. Background jobs also
refresh profiles with active assigned numbers every 15 minutes after a completed
pass, with durable pagination and retries (migration 19). Telnyx remains authoritative for blocks not
observed locally and for the interval before a callback is processed. A callback
cannot recall a request already dispatched. Carrier-level restrictions can still
prevent delivery after a local START update. Apply migration 18 and restart web
and jobs after regenerating both Prisma clients.


Message detail (`GET /v1/sms/{id}`) now includes `recipientOptOut` with `status`
(`blocked`, `not_blocked`, or `unknown`) and nullable `observedAt`. It describes
current observed state for the external participant, not the state when that
message was sent. An inbound message uses its sender; an outbound message uses
its recipient. Existing workspace, legacy-agent, and `sms:read` checks apply
before looking up state. Provider profile IDs and event IDs remain private.

The phone dashboard displays this state with the SMS detail. TypeScript and
Python message models preserve it; message list responses omit it. Unknown means
no callback history is available. A recorded START is not proof of consent or a
guarantee of delivery, and agents cannot change this state through the API.


### Import existing opt-outs

Run from the repository root with the active provider configuration in `.env`:

```sh
pnpm exec dotenv -e .env -- tsx scripts/import-sms-opt-outs.ts
```

This reads Telnyx's [opt-out list API](https://developers.telnyx.com/api-reference/opt-out-management/list-opt-outs)
for `TELNYX_MESSAGING_PROFILE_ID` in pages of 100. It stores blocks using their
provider creation timestamps and the same ordering and locks as callbacks.
Newer START events win over older imported blocks. The command never sends SMS,
changes provider settings, or clears blocks absent from a response.

Output contains only page/record/update counts and `complete`. A failed page or
100-page bound exits nonzero; earlier pages remain saved and rerunning is safe.
Malformed, redacted, or wrong-profile entries reject the entire page. The API is
not a transactional snapshot, so a concurrent provider change can require another
pass. Missing START callbacks are not repaired by treating absence as opt-in.

The September 16 development run completed successfully with zero provider blocks.
