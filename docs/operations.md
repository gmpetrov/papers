# Operation results

Send and phone purchase/release responses include an operation ID and `statusUrl`.
Poll that URL using the same principal and workspace. An operation read returns
`id`, `status`, nullable `resourceId` and `error`, `createdAt`, and optional safe SMS
failure diagnostics. Raw provider responses and internal callback data are hidden.

- `pending`: work has not reached a terminal result; keep polling.
- `unknown`: provider acceptance is uncertain; keep polling and do not resend
  with a new idempotency key.
- `completed`: the action was accepted/completed. For sends, this means provider
  acceptance; inspect message delivery status separately.
- `failed`: the operation is terminal. Review its error before deciding on a new
  request. Replaying the same key does not execute it again.

HTTP 202 is reserved for pending/unknown send or phone operations. A terminal
replay returns HTTP 200, including failed email operations. First accepted email
and SMS sends return HTTP 201. Inbox creation is synchronous and returns the
inbox with HTTP 201, including on an idempotent replay; it does not return an
asynchronous operation response.

The OpenAPI document now provides named schemas for these operation responses,
operation reads, inbox records, approval requests/decisions, email and SMS
records/pages, attachment metadata/download links, and errors. Other response models remain incomplete. Integration tests validate
representative API responses against the shared response contracts.


Email details return stable Papers IDs, RFC message/thread headers, addresses,
plain-text content, timestamps, and safe attachment metadata. Provider message IDs,
raw HTML, object-storage keys, and attachment retry counters are not public fields.
Message text and attachment contents remain untrusted data. Email list responses
omit message bodies and attachments; retrieve a message by its Papers ID for details.

Workspace policy, monthly usage, identity, and event polling responses also have named OpenAPI schemas. Policy updates return the full saved policy, including unchanged approval settings. Event `nextCursor` is a polling checkpoint even on the final nonempty page; an empty page returns null, so clients retain their previous checkpoint. Monthly costs represent reported provider callbacks, not invoices.
