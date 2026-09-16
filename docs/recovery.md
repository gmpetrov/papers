# Database backup and recovery

## Verified local drill

Run `python3 scripts/backup-restore-check.py` with the repository's PostgreSQL
container running on localhost:55433. The script creates two randomly named
`papers_restore_*` databases, applies every checked-in migration to the source,
loads synthetic fixtures, creates a PostgreSQL custom-format archive, and restores
it into the empty target. It compares every public table's row count and content
hash, the schema dump (including constraints, indexes and triggers), and checks
that duplicate inbox addresses are still rejected. It then drops only the two
databases it created and removes the temporary archive. Application and test
databases are neither dumped nor modified. No jobs or provider clients run.

The fixture includes inbox ownership, Unicode email content, an attachment object
reference, exact SMS decimal cost, an unknown operation and its idempotency key,
a pending provider event, opaque webhook ciphertext, and request counters. The
ciphertext is deliberately synthetic: this checks byte preservation, not successful
decryption. Attachment bytes live outside PostgreSQL and are not in this archive.

CI is configured to run the same drill against its PostgreSQL service container;
the GitHub workflow has not yet run. A local pass is
not proof that the managed production database has backups, that its credentials
work during an outage, or that the application can meet a recovery time objective.

Local evidence, September 16, 2026: PostgreSQL 17 restored 42 tables and 40 rows
(including 30 migration records); schema/content comparisons and the uniqueness
check passed. Both disposable databases were confirmed removed afterward.

## Before production launch

Choose the managed PostgreSQL service and configure automated backups plus
point-in-time recovery. Record the retention period, acceptable data-loss window,
recovery-time objective, backup location, and the people able to perform a restore.
Use the provider's current recovery documentation for the selected service.
Schedule restore drills against isolated targets and retain dated results.

Keep the application release/migration version with each backup record. Treat
archives as sensitive: they contain messages, personal data, session information,
and encrypted secrets. Use private encrypted storage with separate backup access;
do not commit archives or put connection strings in logs or shell history.
Back up the required encryption keys separately under restricted access. Database
archives alone cannot recover encrypted customer webhook secrets without those
keys. Maintain a separate recovery policy for private R2 attachment objects.

## Recovery sequence

1. Pause application writes, scheduled jobs, Queue consumers and customer webhook
   delivery. Keep provider ingress durably buffered if possible; otherwise use
   provider retry/retrieval mechanisms and account for their retention limits.
   Preserve the failed database for investigation. Do not restore over it.
2. Restore the chosen backup/PITR point into a new, isolated database. Do not point
   live workers or provider callbacks at the restored database yet. Restore private
   object storage and encryption keys as required by the incident scope.
3. Check migration history, row counts, tenant relationships, unique addresses,
   decimal usage values and encrypted-secret decryption with the corresponding
   application release. Verify referenced attachment objects exist. Check that
   the last required backup interval is present, rather than only testing login.
4. Assess credentials and policies restored to an earlier state: keys or OAuth
   grants revoked after the recovery point may otherwise become valid again.
   Invalidate restored sessions and affected credentials, restore later revocations
   from independent evidence where available, and require fresh authorization.
   Review approval expiry and policy versions before any action can execute.
5. Reconcile external operations with Resend and Telnyx before restarting jobs.
   An unknown send or purchase may have succeeded after the backup point. Preserve
   its original idempotency key and provider reference; never blindly resubmit it.
   Reconcile number ownership, release state, delivery events and opt-outs with
   provider records. Process signed provider retries through normal deduplication.
6. Account for customer webhooks already delivered after the recovery point:
   restored pending delivery rows may replay them. Keep stable event IDs and inform
   consumers of the at-least-once behavior. Inspect stuck processing leases and
   dead-letter records before selectively resuming normal processing.
7. Switch web and jobs database/Hyperdrive configuration to the verified target,
   run authentication/tenant-isolation and signed-ingress checks, then resume jobs
   and traffic in stages. Monitor queue age, failed operations and delivery errors.
   Record the actual data-loss window and recovery time and retain incident evidence.

Provider records, application audit events, and object storage can diverge from
an older database snapshot. This procedure therefore includes reconciliation;
a successful `pg_restore` alone does not establish service recovery.
