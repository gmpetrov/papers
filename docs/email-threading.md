# Email threading

`POST /v1/messages/{id}/reply` accepts `{ "text": "Your reply" }` and requires `Idempotency-Key` plus the `email:send` scope. The message must belong to the caller's organization and delegated agent. It uses the same send quota, recipient policy, operation record, and provider idempotency as a new email.

For an incoming message, recipients come from the stored Reply-To list, falling back to its From address. For an outgoing message, a follow-up uses the original recipients. The subject receives a `Re:` prefix only when absent. Recipient policies apply to the resolved addresses, including Reply-To addresses.

The service preserves its internal thread ID and sends `In-Reply-To` plus `References` when a valid parent Message-ID is known, following [Resend's reply guidance](https://resend.com/docs/dashboard/receiving/reply-to-emails). Incoming references are bounded and validated before reuse as outgoing headers. The newest twenty references are retained. Incoming mail first matches a parsed In-Reply-To within the same inbox, then searches References from newest to oldest for a known ancestor. Messages without a matched parent start a new internal thread; subjects alone never join conversations.

Outgoing Message-ID is populated from the signed `email.sent` webhook when supplied by the provider. Until that identifier arrives, a follow-up retains the internal thread but may appear as a separate thread in external mail clients. Include `email.sent` among the configured Resend webhook event types for this integration. Provider ordering and missing sent-event reconciliation remain release work.

`PATCH /v1/messages/{id}` with `{ "unread": false }` updates read state and requires `inboxes:write`. Reading with GET does not itself change unread state; the dashboard explicitly marks messages as read when opening them.

No live external messages were sent during the automated reply tests. Provider calls were mocked; real recipient-client threading remains an integration check before launch.

The dashboard groups loaded inbox messages by thread and opens the complete conversation in chronological order, including sent and received messages and their attachments. Older inbox pages remain available through Load older messages. The inbox messages endpoint accepts an optional `threadId` filter, scoped to the authorized inbox.
