# Deployment state

Verified September 16, 2026 against the connected Cloudflare account:

| Resource | State |
| --- | --- |
| `papers-attachments` R2 bucket | Created, Standard storage, Western Europe location hint |
| Bucket public access | `r2.dev` disabled; no custom domains |
| `papers-jobs` Queue | Created; no deployed producers or consumers yet |
| Web Worker | Local OpenNext build/runtime verified; not deployed |
| Jobs Worker | Dry-run bundle verified; not deployed |
| Production PostgreSQL | Service/connection still to be selected |
| Hyperdrive | Both configs still contain placeholder IDs |
| Application domain | Awaiting production domain selection |

Both checked-in Wrangler configs already reference the exact bucket and queue
names. Development continues using local binding emulation; creating these
resources does not move application data or provider callbacks into production.
No messages or attachments have been copied to the new resources.

Before deployment, configure a dedicated migrated PostgreSQL database and a
cache-disabled Hyperdrive binding for both Workers. Set the application's
production origin, OAuth callback URLs, provider callbacks, and Worker secrets.
Keep the background Worker standalone without origin routes; enable its
`WEBHOOK_TRANSPORT=cloudflare` only with that deployed configuration.

Deployment must then verify database connectivity, authentication and revocation,
signed provider ingress, scheduled/Queue processing, attachment authorization,
and public-only customer webhook egress in the deployed runtime. Local tests
and successful bundling do not establish these production properties.

CI now builds both the web Worker and jobs Worker. The workflow is configured but
has not yet run on GitHub.

## Latest local runtime verification

The latest Node/database verification through migration 30 passed all 251 tests
in 34 files, plus type checks in all ten packages. It includes selected-resource
OAuth consent and revocation/reconnection isolation. A fresh synthetic database
backup/restore drill also passed through all 30 migrations. These newer OAuth
changes also passed a fresh OpenNext build and both local Worker checks.
The OAuth check verifies resource-picker session/workspace isolation, persistence
of an empty resource selection, enforcement through MCP, and revocation.
The OAuth resource picker also passed interactive browser checks against the
development tunnel for selection counts, empty phone-number state, and permission
changes between restricted and workspace access. This UI preview did not submit
consent; signed consent and token enforcement were checked separately through the
local Worker protocol.

On September 16, the web OpenNext bundle was rebuilt through migration 30, including credential provisioning caps, allowance discovery, inbox lifecycle controls, Google sign-in retry handling, shared request throttling, and selected-resource API keys. The jobs dry-run bundle and isolated Queue runtime were also verified through migration 25. The rebuilt web Worker passed `scripts/workers-check.mjs` and `scripts/workers-oauth-check.mjs`: PostgreSQL, signed Resend ingress, password sessions, Google authorization URL generation, current OpenAPI contracts, workspace policies/usage, API-key MCP tools, OAuth PKCE, scope denial, and revocation. The checks also create a capped API key and update OAuth connection caps through a human session, then verify the resulting allowances through MCP `get_identity`. Both checks now verify inbox and phone-number daily caps as well. Read-only credentials correctly report zero send and provisioning allowance despite positive numeric caps.

The TypeScript SDK and CLI were rebuilt and installed from packed tarballs outside the workspace. `scripts/package-install-check.mjs` verified SDK declarations and runtime pagination, the installed CLI executable, and stdio MCP tool execution. The Python wheel was also rebuilt and passed isolated installation with synchronous/asynchronous pagination. This is package-installation evidence, not npm/PyPI publication or third-party client acceptance.

The jobs Worker passed `scripts/jobs-worker-check.ts --queue` through the local Queue producer/consumer using the isolated `agentinfra_jobs_test` database and empty provider credentials. The synthetic event verified inbound SMS processing, decimal provider cost storage, STOP opt-out persistence, duplicate replay, and cleanup of expired request counters while retaining active counters. Test rows were removed afterward. These checks do not establish live outbound delivery, interactive Google consent, or production deployment readiness.

The full TypeScript integration suite passed all 231 tests after making the
inbound SMS enrichment fixture explicitly control queue eligibility. It checks
that a future-scheduled event leaves cost unknown, then a due event completes
and stores the cost without duplicating the received event. An earlier full run
failed this case, while ten isolated reruns passed before the fixture change;
that evidence does not establish a production cost-update defect.

Migration 25 has now been applied to the local development and both isolated test
databases. It adds authenticated API request limits and idle-counter cleanup; see
[request limits](request-limits.md). The Node integration suite and type checks
pass with the limits enabled. The rebuilt OpenNext Worker passed both runtime scripts. The request-limit check
uses a temporary credential for bounded inbox-list reads, verifies HTTP 429 and
a 1–60 second Retry-After header, then revokes the key. OAuth PKCE, scoped MCP
execution, allowance updates, and connection revocation still pass with the
limiter enabled. This verifies the local workerd runtime, not production hosting.

The isolated [backup/restore drill](recovery.md) passed locally through migration
25: 42 tables, matching schema and contents, and preserved uniqueness enforcement.
Managed production backups, PITR retention, object recovery, and production RPO/RTO
remain unconfigured until the hosting/database choices are completed.

Through migration 26, the local Worker also verifies selected-resource key
metadata, resource/event filtering for empty grants, zero provisioning allowance,
and rejection of inbox/number creation. Existing OAuth checks still pass. Test
keys are revoked; no provider sends or purchases occur in these checks.
