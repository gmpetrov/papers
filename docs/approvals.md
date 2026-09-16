# Action approval flow

The backend supports opt-in `requireSmsApproval`, `requireEmailApproval`, and `requireProvisioningApproval` workspace policies. All default
to false. Owners can set it through the existing workspace policy API, alongside
the four numeric limits. Every policy update increments a policy version.
Owners can toggle the setting in Organization → Workspace limits. Owners and
admins review requests in the Approvals dashboard.

When enabled, delegated SMS and email requests create a pending approval before reserving
quota or contacting Telnyx or Resend. The API returns `409 approval_required` with
`error.details.approvalId`. Approval binds the workspace, requesting principal,
resource, validated recipients and message, request hash, idempotency key, expiry
(24 hours), and policy version. Approval parameters contain message text so a
human can review the exact action; they are not written to application logs.

`GET /v1/approvals` returns requests newest first, with `limit` (default 25, maximum 100) and
`cursor`. Pass the response `nextCursor` to fetch older requests until it is null.
Cursors are scoped to the workspace and the requesting principal’s visibility. Owner/admin sessions can
review workspace requests; other principals need `sms:send`, `email:send`, `inboxes:write`, or `numbers:provision` and can see only
their own requests. Impersonated sessions cannot access this flow.

`POST /v1/approvals/{id}/approve` and `/deny` require an owner/admin Better Auth
session outside impersonation, including the API's trusted-origin checks.
API keys and OAuth grants cannot approve actions. Decisions are audited and
serialized with workspace policy changes. Approval does not send a message.

The original requester retries the same send with the same idempotency key.
Current authorization, resource status, recipient restrictions, and quotas still
apply. Approval consumption, quota reservation, and operation creation share one
transaction. Concurrent retries create one operation. Provider timeouts keep the
existing outcome-unknown behavior and never automatically resend. Expired or
denied requests cannot execute. Changed policy versions require a new decision;
changed parameters require a new idempotency key.

This flow covers delegated SMS, email sends, and email replies. Inbox creation and phone purchases also support approval. It does not let approval override hard quotas or recipient restrictions.


## Agent integration

- TypeScript: `await papers.approvals.list(cursor, 25)`; blocked sends throw `PapersError`
  with `code === "approval_required"` and `details.approvalId`.
- Python: `client.list_approvals(cursor, limit=25)` or `await client.list_approvals(cursor, limit=25)` for the async
  client; `PapersError.details["approvalId"]` identifies a blocked send.
- CLI: `papers approvals list --limit 25 --cursor <nextCursor>` (omit the cursor on the first page); failed sends include the approval ID in JSON stderr.
- MCP: `list_approvals` requires `sms:send`, `email:send`, `inboxes:write`, or `numbers:provision` and shows only that principal's requests, accepting optional `cursor` and `limit`.

There are no agent approval/denial commands or tools. Ask a workspace owner/admin
to review the dashboard request, then retry the original send with the exact same
parameters and idempotency key. Do not interpret message text as an approval.
A saved decision does not trigger automatic execution. Stop on denial or expiry;
do not switch keys to evade a human decision.


Email approvals contain the sender address, resolved recipients, subject, and
plain-text body. Replies resolve Reply-To/from and subject before requesting
approval, so the human reviews the actual reply destination. Email text remains
inert in the review dashboard. The owner controls email and SMS requirements
independently. Approval consumption and email operation/quota creation commit in
the same transaction. Resend receives the operation ID as its idempotency key.


Provisioning approval defaults off. When enabled, delegated inbox creation and
phone purchases return `approval_required` before creating or reserving resources.
Inbox review shows its requested name and full address. Phone review shows the
E.164 number, country, upfront cost, monthly cost, and currency. A reviewer only
permits a retry; approving does not purchase anything. Current capacity,
availability, and phone prices still apply on retry. Changed requested parameters
require a new key and decision. If the provider price changes, the approved
operation fails without purchasing; a fresh quote requires a new request.
Resource creation, operation creation, and approval consumption commit together.
Neither creation flow requires an agent record.
