# Production deployment

Deployed September 17, 2026 at **https://www.papers.bot**.

| Resource | State |
| --- | --- |
| Web Worker `papers-web` | Deployed with HTTPS custom domain |
| Jobs Worker `papers-jobs` | Deployed, Queue consumer and every-minute schedule active |
| PostgreSQL | Dedicated Prisma Postgres database; all 30 migrations applied |
| Hyperdrive `papers-production` | Query caching disabled; origin connection limit 5 |
| R2 `papers-attachments` | Private bucket bound to both Workers |
| Queue `papers-jobs` | Producer and consumer deployed |
| Worker secrets | Installed from the ignored production environment file |
| Development data | Not migrated; awaiting the user's fresh-start/migration choice |
| Resend and Telnyx callbacks | Not switched; pending the same data decision |

Production uses `apps/web/wrangler.production.jsonc` and
`apps/jobs/wrangler.production.jsonc`. The ordinary Wrangler configurations remain
for local development. `.env.production` is ignored and contains the production
database and Google credentials; both public/auth origins include `https://`.
Never commit environment files or secret bulk-upload bundles.

## Automatic deployments from GitHub

Use Cloudflare Workers Builds with the existing `gmpetrov/papers` GitHub
connection. Each Worker has its own pipeline, rooted at `/`:

| Worker | Production branch | Build command | Deploy command |
| --- | --- | --- | --- |
| `papers-web` | `main` | `pnpm run cf:build:web` | `pnpm run cf:deploy:web` |
| `papers-jobs` | `main` | `pnpm run cf:build:jobs` | `pnpm run cf:deploy:jobs` |

Disable preview builds for both pipelines. Set `PNPM_VERSION=10.32.1` in
each pipeline's build variables; `.node-version` pins Node. Add `DATABASE_URL`
from the ignored production environment file as an **encrypted build secret**
for both Workers. Build secrets are separate from runtime secrets. Existing
runtime credentials and the Hyperdrive binding remain configured on the Workers.
Do not copy production secrets into GitHub or source files.

The build commands generate Prisma clients, typecheck the monorepo, and build the
target Worker. Deploy commands reject non-main builds, run `prisma migrate
deploy`, then deploy using the production Wrangler configuration. Prisma's
migration lock protects simultaneous migration attempts; only lock timeouts are
retried. A migration failure prevents that pipeline's deployment. The web
pipeline checks `/api/health` after deployment, including database connectivity.

These are independent releases, not an atomic deployment of both Workers.
Migrations and message payload changes must remain compatible with both the old
and new Worker versions. Use additive migrations and remove old schema only in
a later release. A failed health check marks the build failed; it does not roll
back the Worker or database. GitHub Actions verification runs independently and
does not gate native Cloudflare deployments from a direct push to main.

Setup status (September 17, 2026): both native GitHub connections are active on
`main`, preview builds are disabled, and both pipelines have encrypted
`DATABASE_URL` build secrets and `PNPM_VERSION=10.32.1`. They share the
`Papers production builds` deployment token. The local production builds and
deployment failure guards passed verification. Commit and push these setup files
to start the first native build; a Git-triggered deployment has not yet been
verified. Confirm successful builds for **both** Workers and the deployed commit
in the Cloudflare dashboard after that push.

References: [GitHub integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)
and [build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

## Verified in production

Public pages, login, database health, API authentication, OpenAPI, and OAuth
metadata passed HTTP checks. Google authorization uses the production client and
`https://www.papers.bot/api/auth/callback/google`; the browser reached Google's
account chooser. Completing a user's Google login is still unverified.

Unsigned provider webhooks were rejected. A signed synthetic Resend event for an
unknown recipient was accepted, queued, and processed once without errors. Its
test row was removed. No email or SMS was sent. Queue execution and scheduled
background cycles reported no failures. Existing live provider callbacks still
point to development, so these checks do not establish live production delivery.

The public asset bundle was checked for production secret values; none matched.
All ten package type checks passed. Before deployment the full suite passed
255 TypeScript and 46 Python tests. Deployment exposed a jobs Worker startup
issue caused by the Node Prisma runtime; the database package now selects its
edge entry point under Wrangler's `workerd` export condition.

## Updating production

Run from the repository root with pnpm installed. Keep the production env file
private. Apply reviewed migrations before deploying code that requires them:

```sh
pnpm exec dotenv -e .env.production -- pnpm --filter @agentinfra/db migrate
pnpm exec dotenv -e .env.production -- pnpm --filter @agentinfra/web exec opennextjs-cloudflare build --config wrangler.production.jsonc
pnpm exec wrangler deploy --config apps/web/wrangler.production.jsonc
pnpm exec wrangler deploy --config apps/jobs/wrangler.production.jsonc
```

To update secrets, use `wrangler secret bulk` with a private JSON file and the
appropriate production config. Remove temporary upload files afterward. Database
credentials belong in Hyperdrive rather than Worker vars. Recheck health,
authentication, Queue processing and scheduled logs after deployment.

## Remaining cutover work

Resolve whether to migrate existing workspaces, inboxes, messages, phone numbers
and attachment objects. Coordinate development processors and production data
before changing the shared Resend webhook and Telnyx messaging profile to the
production endpoints. Do not route existing resources into an empty database.
Managed backup/PITR retention, object recovery, production RPO/RTO, live delivery,
and full interactive authentication checks remain to be verified.

## Historical local runtime verification

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

## Organization creation incident — September 17

The production request at 09:02:14 UTC returned HTTP 500 after 12.47 seconds.
The stored invocation contains only the `pg-pool`/Prisma stack, without the
underlying database error message or code; no trace spans were retained.
The subsequent user request at 09:03:02 succeeded. The production workspace has
its owner membership, default team and default project. A disposable production
account also created a workspace successfully, including while eight concurrent
session reads ran; all temporary account/workspace rows were removed afterward.

Authentication now records structured `auth_request_failed` diagnostics with
nested database error codes and timeout/connection categories. SQL, parameters,
raw error messages and credentials are excluded. This corrects the diagnostic
gap; it does not establish or fix the original transient failure's root cause.
The organization integration test covers owner/team/project creation, active
workspace selection and duplicate-slug rejection. Connection limits and write
retry behavior were not changed without evidence.

## Dashboard latency — September 17

The web Worker's production config now uses `placement.region: aws:us-east-1`
to execute near the primary database. Workers remain on Cloudflare infrastructure;
this is a proximity hint, not a deployment inside AWS. Placement applies to fetch
handlers, so the jobs Worker configuration was not changed. Hyperdrive query
caching stays disabled for authorization and other consistency-sensitive reads.

A Paris-origin HTTP comparison used a disposable authenticated account and empty
workspace, with five sequential samples per endpoint. Median full-response times:

| Endpoint | Default placement | US-east placement, warmed |
| --- | ---: | ---: |
| Dashboard overview HTML | 670 ms | 305 ms |
| Session | 461 ms | 228 ms |
| Inbox list | 1204 ms | 345 ms |
| Public homepage HTML | 47 ms | 174 ms |

These are small synthetic samples, not field percentiles or browser load times.
The first post-placement run was noisier (overview 627 ms, inboxes 362 ms).
The public HTML tradeoff is expected because the same Worker serves public and
authenticated pages. Direct static assets continue to be served near visitors.
If public HTML latency becomes significant, split its serving path from the
regional database-backed handlers. A login-page browser trace before the change
showed LCP 344 ms and CLS 0; that is not an authenticated dashboard measurement.
All temporary test accounts and workspaces were cleaned up after measurements.

Dashboard loading now requests inboxes only for Overview and Inboxes, avoiding an
unrelated blocking API request on other sections. Organization details and teams
load concurrently. Production build and web type checks passed.

Reference: https://developers.cloudflare.com/workers/configuration/placement/
