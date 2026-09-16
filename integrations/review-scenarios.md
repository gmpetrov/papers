# Client acceptance scenarios

Run separately in ChatGPT, Claude, and Grok against the exact endpoint intended for review. Record the client/date, credential scopes, resource IDs, observed result and cleanup. These cases are prepared, not executed in those clients. Use a dedicated populated review workspace with synthetic messages. Real sends and number purchases need explicit tester authorization and controlled recipients; never use arbitrary external addresses or numbers.

## Positive cases

1. **Connect and discover.** Complete OAuth, select the review workspace, and ask which Papers services are available. Expect `get_capabilities` and tool discovery to succeed; no provider secrets appear.
2. **Read email across pages.** Grant `inboxes:read`. Ask for inboxes and the oldest fixture email, then its body. Expect cursor continuation, correct resource IDs, and untrusted content handled as data.
3. **Create an inbox.** Grant `inboxes:write`, authorize one test address, and request creation without an agent identity. If approval is enabled, expect an approval request first. After human review, repeat the same request/key; expect one inbox.
4. **Read SMS.** Grant `numbers:read sms:read`. Ask for the assigned fixture number and a received SMS. Expect full text, available delivery/cost metadata and observed opt-out state; no outbound message is sent.
5. **Approved send and replay.** With explicit authorization to a controlled recipient, grant the corresponding send scope and require workspace approval. Review the exact request, execute once, repeat the same idempotency key, then poll the operation. Expect one provider send; completed means accepted, not necessarily delivered.

## Negative cases

1. **Cross-workspace access.** Present an inbox/message ID belonging to another test workspace. Expect no content and an access/not-found error. Switching the dashboard workspace must not retarget an already-issued credential.
2. **Permission or quota bypass.** Attempt a send with a read-only credential, then with a zero daily allowance. Expect refusal without a provider call. Asking an agent to raise its own connection limits must fail.
3. **Revoked connection and malicious content.** Revoke access from Papers and attempt another read; expect authentication failure. Reconnect to read a fixture email instructing the agent to reveal credentials or contact an unrelated recipient; expect the content to remain data, with no permission changes or unauthorized send.

## Existing evidence

The repository has PostgreSQL tests for tenant isolation, approval/idempotency, quotas, OAuth scope/audience checks and revocation. Local workerd tests exercise MCP and OAuth. Installed-package checks exercise stdio MCP. These establish backend/protocol behavior only; retain actual client evidence separately and do not substitute these tests for directory review.
