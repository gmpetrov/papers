# Background jobs on Cloudflare

`apps/jobs` contains a scheduled Worker for Resend ingestion, Telnyx ingestion,
number reconciliation, saved SMS acceptance recovery, attachment storage, and
cleanup of expired API request counters.
It runs one bounded batch per lane on queue notifications and every minute.
Each lane retains the core
database claims, leases, deduplication, and retry behavior. A failure in one
lane does not prevent the others from running; the invocation reports failure
after attempting all lanes. Logs include lane names and counts, never raw
provider exceptions or message contents.

The Worker opens a Prisma edge client through the Hyperdrive binding inside
each invocation and disconnects it in `finally`. Attachments use the native R2
binding. There is no public HTTP job-trigger endpoint, and workers.dev and
preview URLs are disabled. The local Node runner uses the same batch runner.

The Worker has passed a Wrangler bundle dry run and a local workerd test against
PostgreSQL. It has **not been deployed**. Before deployment, replace the all-zero
Hyperdrive ID in `apps/jobs/wrangler.jsonc` with a real configuration targeting
the application's migrated PostgreSQL database. Disable Hyperdrive query caching
for these mutable job queries. Bind the same private `papers-attachments` bucket
used by the web app, and install `RESEND_API_KEY` and `TELNYX_API_KEY` as Worker
secrets. They are not included in the repository or copied to this Worker by
local tests. Apply migrations before enabling scheduled processing. Create the
`papers-jobs` Queue before deploying its web producer and jobs consumer bindings.

Verified provider webhooks first commit their durable database event, then
schedule a minimal queue notification with `waitUntil`. Queue messages contain
no message bodies, addresses, or credentials. Queue send failures are logged
with a fixed event code and do not change the successful webhook acknowledgment;
the scheduled scan recovers the database work. The queue consumer processes one
batch of database work, acknowledges on successful return, and retries failed
invocations up to three times with a 60-second delay. Database rows retain their
own retry/backoff state even when a notification is acknowledged. Exhausting
queue retries therefore does not delete the underlying work.

From the repository root:

```sh
pnpm --filter @agentinfra/jobs cf:typegen
pnpm --filter @agentinfra/jobs typecheck
pnpm --filter @agentinfra/jobs build
```

`build` is a dry run and does not publish or create cloud resources. The committed
Hyperdrive ID is a placeholder; the local connection defaults to `agentinfra_test`.
For the isolated runtime check, create and migrate `agentinfra_jobs_test`, then
run:

```sh
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_jobs_test pnpm --filter @agentinfra/jobs dev:worker --env-file ../../scripts/fixtures/jobs-worker.env
pnpm exec tsx scripts/jobs-worker-check.ts
```

The check creates temporary synthetic incoming SMS records, triggers
`/__scheduled` in Wrangler's local test mode, verifies processing and duplicate
replay, and removes its fixtures. It uses no provider secrets and makes no
provider API requests. Missing-secret warnings are expected for this isolated
check. Do not run this check concurrently with a Worker pointed at another
database on port 3002.

To test the actual Queue producer/consumer path instead, stop the scheduled test
server and run these from the repository root:

```sh
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_jobs_test pnpm exec wrangler dev -c scripts/fixtures/jobs-queue-producer.jsonc -c apps/jobs/wrangler.jsonc --env-file scripts/fixtures/jobs-worker.env --port 3002
pnpm exec tsx scripts/jobs-worker-check.ts --queue
```

The producer fixture exposes an unauthenticated localhost notification endpoint
for testing only; never deploy it. The fixture env file explicitly clears provider
credentials. This check verifies asynchronous Queue delivery, provider cost recording, STOP opt-out persistence, and deduplication
against the real local workerd consumer. Through migration 25 it also verifies
that idle request-limit buckets are removed and current counters remain intact. Normal `pnpm dev` plus `pnpm jobs` still
uses database polling; testing local Queue delivery requires multi-Worker mode.

Production provisioning, deployment, backlog monitoring, and capacity/load
verification remain outstanding. The implemented queue and minute-based fallback
do not establish production throughput or delivery latency.

References: [scheduled handlers](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/),
[Queue local development](https://developers.cloudflare.com/queues/configuration/local-development/),
[Queue retries](https://developers.cloudflare.com/queues/configuration/batching-retries/),
[Hyperdrive local development](https://developers.cloudflare.com/hyperdrive/configuration/local-development/),
and [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).

Customer delivery uses an additional lane when a transport is configured. Node
jobs use the DNS-pinned HTTPS adapter. The deployed standalone Cloudflare Worker
uses global public-only fetch when `WEBHOOK_TRANSPORT=cloudflare`; the checked-in
value is `disabled` for local Workerd. Install `CUSTOM_WEBHOOK_ENCRYPTION_KEY` as a
jobs secret matching web, and follow [customer webhook deployment requirements](customer-webhooks.md).

## SMS opt-out refresh

Migration 19 adds durable per-profile import progress. When Telnyx is active and
its key is configured, the shared Node/Workers runner imports one opt-out page
per cycle for profiles with active assigned numbers. Successful pages and their
checkpoint commit together. A completed pass restarts from page one after 15
minutes; failed pages retry after five minutes. Claims expire after 60 seconds,
and completion checks the claim token before applying any records.

Only counts and a fixed failure code are logged. Provider list responses cannot
clear local blocks; a verified newer START callback remains necessary. Provider
pagination is not a snapshot, so repeated passes also recover records shifted
between pages during a scan. `ProviderSmsOptOutSync.lastCompletedAt`,
`availableAt`, and `lastError` expose internal operational progress. This adds no
provider mutations or outbound messages.

Use the read-only [operator status check](job-monitoring.md) to inspect database
backlog and stuck work. External alerting and heartbeat monitoring remain deployment work.
