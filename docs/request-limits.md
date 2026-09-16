# API request limits

Authenticated API requests share PostgreSQL-backed fixed windows aligned to UTC
minutes: 120 requests per credential (or signed-in user) and 1,200 per workspace.
These defaults apply across app instances. API-key requests share by key ID;
OAuth requests share by consent, including refreshed access tokens; human sessions
share by user within a workspace. Credential rotation cannot bypass the workspace
limit. These request limits are separate from daily send/provisioning quotas.

A rejected request returns HTTP 429, error code `rate_limited`, `retryable: true`,
and `Retry-After` with 1–60 seconds until the window resets. Rejected authenticated
requests count toward the workspace limit. Invalid credentials return 401 before
consuming allowance. Signed attachment downloads consume the original principal's
allowance. Provider webhook ingress and account sign-in do not use these buckets.
This is application-level throttling; edge protection against unauthenticated
traffic remains a separate deployment concern. Fixed windows allow a burst on
each side of a minute boundary.

Remote MCP authentication consumes one request for `/v1/me`; each underlying API
operation consumes another. A typical tool call therefore consumes two requests.
Stdio MCP uses the same API allowance. Rate limiting a remote authentication check
returns HTTP 429 with Retry-After; rate limiting a tool operation returns a tool
error with `retryAfterSeconds`. Tool errors never mean an operation succeeded.

The TypeScript error exposes `retryAfterSeconds`; Python exposes
`retry_after_seconds`. Both preserve valid integer delay headers and leave
malformed headers unset. The clients do not automatically replay requests. Wait
at least the indicated delay; when retrying an external mutation, keep the original
idempotency key and parameters. Daily quota errors use `quota_exceeded` and do not
use the minute-window retry delay.

Migration 25 adds the shared counters. Each principal reuses one row; the background
worker removes up to 1,000 buckets idle for over 24 hours per pass. Organization
deletion cascades to its buckets. Apply migrations before updating web/jobs workers.
