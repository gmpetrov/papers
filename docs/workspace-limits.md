# Workspace limits

Organization settings shows the current workspace's daily email and SMS limits,
maximum active inboxes, and maximum phone numbers. Members can read these
settings; only an owner using their own dashboard session can change them.
API keys, delegated OAuth credentials, administrators who are not owners, and
impersonated sessions cannot change these limits.

`GET /v1/workspace/policy` returns `{ policy, usage }` for the active workspace.
`PATCH /v1/workspace/policy` accepts all four integer fields: `dailyEmailLimit`,
`dailySmsLimit`, `maxInboxes`, and `maxPhoneNumbers`. Sending limits range from
0 to 10,000 and resource limits from 0 to 100. Updates require a trusted Origin
and are audited atomically. The most recent successful update wins.

Daily counters reset by UTC date and count reserved send attempts, including
unknown and failed provider outcomes. Replaying an existing idempotency key
does not consume another unit. These counters are controls on application
activity, not a provider invoice or a count of delivered messages.

Zero pauses new sends or resource creation. Lowering a limit below current
usage blocks additional activity; it never deletes resources, cancels a send
already reserved, or refunds previous usage. Phone-number usage includes
pending, unknown, regulatory-pending, active, and releasing numbers. Failed
and released numbers do not consume the resource allowance.

Reactivating an archived inbox consumes an active-inbox slot, just like creating
one. Both operations share the workspace lock, so concurrent requests cannot
overfill the allowance. Archiving frees a slot and preserves history. Members
cannot archive or reactivate inboxes; authorized owners, administrators, and
delegated credentials with `inboxes:write` can. Repeating an inbox's current
status is a no-op; actual changes produce one audit record and one
`inbox.archived` or `inbox.reactivated` event.

Workspace limits apply to legacy agent-linked resources too. Their individual
limits and recipient restrictions can further restrict access. Migration
`20260916150000_workspace_usage_totals` adds historical legacy usage to existing
workspace counters. Deploy that migration with the updated send code; avoid a
rolling deployment where old instances continue writing only legacy counters.

The form uses the shared Zod schema and react-hook-form. Browser verification
is in `scripts/workspace-limits-browser-check.mjs`, using mocked policy requests
so it does not alter live workspace limits or send messages.

## API-key send limits

New API keys can specify optional `dailyEmailLimit` and `dailySmsLimit` in
`POST /v1/api-keys` or the creation dialog. Integers from 0 to 10,000 are accepted.
Null or omission adds no key-specific cap; workspace and legacy agent limits
still apply. Zero blocks new sends for that channel. Limits are visible in the
API-key list. To change a key's limits, create a replacement and revoke the old
key; an update endpoint is not implemented.

Migration 22 adds nullable limits (existing keys keep their previous behavior)
and per-key UTC-day counters. A send reserves key usage, workspace usage, and
its operation in one transaction under the workspace lock. Failed downstream
quota checks roll back the key reservation. Pending human approval consumes
nothing. Provider failures or unknown outcomes retain the reservation; replay
of an existing operation does not consume another unit. Email and SMS counters
are separate. API-key and OAuth connection limits are independent. Monetary spending budgets remain outstanding.

`GET /v1/me` exposes `sendLimits` for the caller: UTC `day`, `resetsAt`, and
`email`/`sms` entries containing `dailyLimit`, `remaining`, and `approvalRequired`.
The effective allowance is the minimum remaining workspace, API-key, and legacy
agent allowance applicable to the credential. A missing send scope or member
role reports zero remaining. The result is a planning snapshot, not a reservation
or authorization: recipient restrictions, resource-specific legacy policies,
opt-outs, provider availability and concurrent activity may still block a send.
No other credential's usage is returned. OAuth connections include their connection-specific caps when configured.

## OAuth connection send limits

Migration 23 adds nullable daily limits and UTC-day usage attached to the stored
consent. Owners/admins can edit their own connection in Dashboard → Integrations,
or PATCH `/v1/connections/{id}/limits` with both `dailyEmailLimit` and
`dailySmsLimit` (null or integer 0–10,000). A human session is required;
impersonation, agent credentials, other users' connections, and other workspaces
cannot change these settings. Updates are audited and share the send transaction's
workspace lock. Lowering a limit never resets usage or cancels already reserved work.

The same connection shares counters across access-token refreshes, REST/MCP
credentials, and concurrent sends. New daily counters begin at deployment; existing
connections have no additional cap until configured. Revoking and authorizing a
new consent creates a new connection; workspace counters still apply. `GET /v1/me`
includes these caps in the effective allowance snapshot. No monetary spend cap
or resource provisioning cap is implied by a daily send limit.

## Daily resource creation limits per credential

API-key creation accepts nullable `dailyInboxLimit` and `dailyNumberLimit`
(0–10,000). The key form exposes both. Owners/admins can set the same limits
for their OAuth connections under Integrations → Daily limits, or with
`PATCH /v1/connections/{id}/limits`. Omitted creation-limit fields on that
PATCH preserve their current values. Existing credentials default to null,
meaning no additional credential cap; workspace capacity still applies.
Zero blocks new creations of that resource type.

Counters reset by UTC date and remain separate from send counters. Inbox
creation consumes one unit in the transaction that creates the inbox. A phone
purchase reserves one unit when its operation is recorded, before inventory
revalidation/provider calls; failed and unknown purchase operations retain that
unit. Human approval does not bypass the cap. Pending approvals consume none,
transaction rollback consumes none, and an idempotent replay consumes no extra
unit. Releasing a number or archiving an inbox does not refund daily usage.
OAuth refresh tokens share the consent's counters. These are action counts,
not communication-cost budgets.

Apply migration 24 and regenerate both Prisma clients before running the new
code. Historical creations are not backfilled into the new counters.

`GET /v1/me` and MCP `get_identity` expose `provisioningLimits` with a UTC
`day`, `resetsAt`, and separate `inboxes` / `phoneNumbers` objects. Each includes
`dailyLimit` (nullable), `capacityRemaining`, `remaining`, and
`approvalRequired`. Remaining allowance combines credential daily usage,
workspace capacity, applicable legacy-agent inbox capacity, and action scopes.
A missing scope reports zero remaining; it cannot be overridden by a positive
numeric cap. Pending/unknown phone assignments consume capacity, while released
and failed assignments do not. Daily purchase usage is not refunded when an
assignment is released or fails.

This is a consistent database snapshot for planning, not an authorization or
reservation. Other requests can consume capacity afterward. Check provider
availability with `/v1/capabilities`, and obtain required approval before acting.
