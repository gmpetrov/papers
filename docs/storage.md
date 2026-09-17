# Papers object storage

Use one **private Cloudflare R2 bucket, `papers`**, for project files. The existing
`ATTACHMENTS` binding points to it in the web and jobs configurations, including
production. Code writes attachment objects under:

```text
papers                         # bucket
└── attachments/
    └── {workspaceId}/
        └── {messageId}/
            └── {attachmentId}
```

Both email and SMS/MMS use this layout for new objects. Existing keys are copied
unchanged, so old links and database references continue working. Filenames are
metadata, never paths. Future project data can use separate prefixes without
creating another bucket or exposing attachments publicly.

## Prepared September 17, 2026

- Created cloud bucket `papers`, with the same Western Europe location hint as
  the previous bucket. Confirmed r2.dev access disabled and no custom domains.
- Verified cloud upload/download byte equality and removed the synthetic probe.
- Retained the default seven-day incomplete multipart cleanup rule. There is no
  expiration rule for completed attachments and no browser CORS exposure.
- Applied the additive multichannel attachment migration to production; all 32
  checked-in migrations are applied. The production database had no attachment
  rows, and the legacy cloud bucket reported zero objects.
- Verified required web/jobs secret **names** already exist; production configs
  now declare those requirements so missing secrets are caught by deployment.
- Copied the existing 328,991-byte development attachment to the local `papers`
  emulator bucket, preserving its key and checking SHA-256 equality. Development
  files have not been uploaded to cloud storage.

Cloud provisioning and database preparation do not publish a new app version.
The checked-in binding change takes effect in production on the next deployment
of each Worker. Keep `papers-attachments` until both live bindings are switched;
removing a bucket still referenced by a live Worker would break that Worker.

## Local development

Both processes use `.wrangler/shared` and local R2, not the cloud bucket. For an
older checkout with stored local files, stop web/jobs writers, run the copy,
then restart both processes with the updated configuration:

```sh
pnpm exec tsx scripts/migrate-local-attachments.ts
pnpm dev
```

The copy is repeatable: it verifies existing destination bytes, fails on
conflicts, and never overwrites an existing destination or deletes the source.
It copies only `attachments/` and uses no production credentials. Existing
local source bytes are retained for rollback.

## Production cutover

1. Check current production data before deployment. If the old bucket gained
   objects, copy them with the same keys and verify content before switching.
   Pause attachment writers during a nonempty bucket migration, make a final
   delta pass, and verify every database `objectKey` exists in the destination.
   Bucket metric counts can lag; do not use an empty metric alone as deletion
   authorization. Preserve source objects until the rollout is verified.
2. Run `node scripts/production-storage-check.mjs`. It checks all four binding
   configurations and performs a remote 64-byte write/read/delete under a random
   `attachments/_checks/` key. It requires authenticated Wrangler R2 access.
3. Run `pnpm cf:build:jobs`, then `pnpm cf:build:web` **sequentially** in one
   checkout; both regenerate shared Prisma artifacts. Cloudflare Builds use
   independent checkouts. Both builds must pass before publishing.
4. Use the existing main-branch Cloudflare Builds pipelines, or the manual
   deployment sequence in [deployment.md](deployment.md). Migration runs before
   Worker publication. Deploy **both** web and jobs; check the live versions
   reference `ATTACHMENTS → papers`, the jobs Queue consumer and minute schedule
   are healthy, and the web origin remains `https://www.papers.bot`.
5. Verify one controlled inbound attachment becomes ready and downloads through
   an authenticated API request. Test email send and MMS only to authorized
   recipients; MMS additionally needs a verified billing ceiling. The R2 smoke
   check does not exercise provider/carrier delivery. Provider callbacks and
   development data cutover remain separate launch decisions.
6. After both Workers have switched, verify no other configuration references
   the old bucket and no data remains to migrate, then retire `papers-attachments`.
   This preparation task intentionally does not delete a live-bound bucket.

## Rollback and recovery

Before new writes use the new bucket, restoring both old Worker configurations
is sufficient because the source was retained. After new writes begin, keep the
`papers` binding when rolling code back, or copy the new objects back and verify
them first; reverting just a bucket name would strand new database references.
The migration is additive and supports the previous email-only code; do not drop
columns during application rollback.

Database backups contain keys and metadata, not R2 bytes. Keep database and
object recovery plans coordinated. No automatic garbage collection for orphaned
or deleted-message objects is implemented; do not add a whole-bucket TTL as a
substitute. A retention policy must account for database references and in-flight
sends before removing files.
