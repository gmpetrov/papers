/** Rename the already-applied attachment migration without changing its SQL or checksum.
 * Its original timestamp preceded SmsRate creation, breaking fresh installations.
 * Runs before Prisma deploy for both fresh and existing databases; no application
 * tables or schema are modified here. Keep until all installations have upgraded.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createDatabase } from "../packages/db/src/index";
import { migrationDatabaseUrl } from "../packages/db/migration-url";

const oldName = "20260917120000_multichannel_attachments";
const newName = "20260917160000_multichannel_attachments";
const sql = await readFile(
  new URL(
    `../packages/db/prisma/migrations/${newName}/migration.sql`,
    import.meta.url,
  ),
);
const checksum = createHash("sha256").update(sql).digest("hex");
const db = createDatabase(migrationDatabaseUrl());
try {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('papers:attachment-migration-order'))`;
    const [table] = await tx.$queryRaw<
      { exists: boolean }[]
    >`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS "exists"`;
    if (!table?.exists) return;
    const rows = await tx.$queryRaw<
      {
        id: string;
        migration_name: string;
        checksum: string;
        finished_at: Date | null;
        rolled_back_at: Date | null;
      }[]
    >`
      SELECT id, migration_name, checksum, finished_at, rolled_back_at
      FROM "_prisma_migrations" WHERE migration_name IN (${oldName}, ${newName})`;
    const old = rows.filter(
      (row) => row.migration_name === oldName && !row.rolled_back_at,
    );
    if (!old.length) return;
    if (
      old.length !== 1 ||
      !old[0]!.finished_at ||
      old[0]!.checksum !== checksum ||
      rows.some((row) => row.migration_name === newName)
    )
      throw new Error(
        "Attachment migration history needs operator review; no history was changed",
      );
    await tx.$executeRaw`UPDATE "_prisma_migrations" SET migration_name = ${newName} WHERE id = ${old[0]!.id} AND checksum = ${checksum}`;
    console.log(
      "Normalized applied attachment migration name; SQL checksum and application data unchanged.",
    );
  });
} finally {
  await db.$disconnect();
}
