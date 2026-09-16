# Background job monitoring

Run `pnpm jobs:status` from the repository root to inspect the database configured
in the local `.env`. For an explicitly configured operator environment, run
`pnpm exec tsx scripts/job-status.ts` with `DATABASE_URL` set securely. The script
requires database access, opens a read-only repeatable-read transaction, and never
calls Resend, Telnyx or customer endpoints. Do not expose this cross-workspace
operator check as a tenant API or public health endpoint.

The JSON snapshot includes the database observation time and aggregate counts,
attention counts, and oldest ages for due provider events, expired processing
leases, dead letters, webhook deliveries, number reconciliation, regulatory
requirements, unknown operations, attachments, and failed opt-out refreshes.
It deliberately excludes IDs, addresses, message bodies, webhook URLs, provider
payloads and credentials. Counts are grouped by work category; one underlying
incident can appear in more than one category, so do not sum them as unique issues.

Exit status is 0 when no attention condition is detected, 2 when work needs
attention, and 1 when the check cannot run. Ordinary due work and unknown operations
become actionable after 15 minutes. Age for queued work starts at its due time;
a future scheduled retry does not trigger a backlog warning. Unknown operation age
uses creation time so reconciliation attempts cannot keep masking it. Expired
leases, dead letters, exhausted delivery/storage retries, pending regulatory
requirements and due failed opt-out refreshes need attention immediately.

A zero result only describes the stored work visible in that snapshot. It does not
prove that workers are alive when queues are empty, that provider ingress is
reachable, or that carrier delivery works. Production still needs an external
monitoring runner, alert destination, job heartbeat checks and threshold tuning
for the expected workload. This command does not schedule checks or send alerts.

## Responding to findings

- Due provider-event backlog or expired leases: check worker invocations, database
  connectivity and failed lane counts. Restore normal processing before replaying
  anything manually. Null processing leases require investigation; ordinary
  expired leases are reclaimed by the workers.
- Dead-letter events or exhausted attachment/webhook retries: inspect the specific
  records through authorized operator access, diagnose the failure, and preserve
  the original event IDs and signatures. Do not bulk reset all failures.
- Unknown operations: correlate saved provider identifiers and idempotency keys
  with provider records. An unknown result is not proof that a send or purchase
  failed. Follow [recovery and reconciliation](recovery.md) before any retry.
- Number requirements: complete the provider's required documents in Telnyx;
  repeatedly submitting a purchase cannot satisfy regulatory requirements.
- Opt-out refresh failures: check provider access and profile configuration. A
  failed refresh cannot be interpreted as proof that a recipient is opted in.

On September 16, 2026, the development snapshot reported one old unknown operation
and zero entries in the other categories. The check returned exit status 2. It
made no state changes and did not resend that operation. Fixture tests cover
scheduled retries, stale processing, dead letters, exhausted retries, privacy of
output, and non-mutation of provider records.
