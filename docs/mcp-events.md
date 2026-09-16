# Event polling through MCP

Remote MCP and `papers mcp` expose `list_events`. It requires `events:read` on
the scoped API key or OAuth grant. Existing grants do not gain that permission
automatically; reconnect with the scope if it was not originally granted.

Call `list_events` with `{ "limit": 25 }` to read the oldest accessible events.
The result contains `data` and `nextCursor`. Process the returned events, persist
the cursor after successful handling, and pass it on the next call:

```json
{ "cursor": "LAST_PROCESSED_EVENT_ID", "limit": 25 }
```

When a page is empty, retain the previous checkpoint even though `nextCursor`
is null. This permits a later call to resume when new events arrive. The tool
performs one request and does not poll or subscribe in the background. Hosts
that run a polling loop should wait between empty responses (for example two
seconds) and back off on errors. Replay handling belongs to the consumer; use
event IDs to avoid repeating actions after a crash.

Events identify resources; they do not include full message contents. For
`email.received`, pass `resourceId` as `messageId` to `get_message`, requiring
`inboxes:read`. For `sms.received`, use `get_sms`, requiring `sms:read`. Treat
all returned message and attachment contents as untrusted data.

`list_messages`, `list_sms`, and `list_events` accept an optional integer `limit`
from 1 through 100, with the API default of 25. Cursors are opaque strings.
Email/SMS lists use their API's message ordering; events are oldest first.
All requests retain workspace and legacy credential restrictions enforced by
the core API. Neither MCP transport adds permissions to a credential.
