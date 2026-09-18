/** Isolated local PostgreSQL regression check; never resets a shared database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createDatabase } from "../packages/db/src/index";
import { migrationDatabaseUrl } from "../packages/db/migration-url";
const pooled =
  "postgresql://user:password@pooled.db.prisma.io:5432/postgres?sslmode=require";
assert.equal(
  migrationDatabaseUrl({ DATABASE_URL: pooled }),
  pooled.replace("pooled.db.prisma.io", "db.prisma.io"),
);
assert.equal(
  migrationDatabaseUrl({
    DATABASE_URL: pooled,
    DIRECT_URL: "postgresql://localhost/direct",
  }),
  "postgresql://localhost/direct",
);
assert.equal(
  migrationDatabaseUrl({ DATABASE_URL: "postgresql://localhost/local" }),
  "postgresql://localhost/local",
);
const source = new URL(
  process.env.DATABASE_URL ??
    "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra",
);
assert(
  ["localhost", "127.0.0.1"].includes(source.hostname),
  "Local PostgreSQL only",
);
const name = `papers_migration_${randomUUID().replaceAll("-", "")}`;
const target = new URL(source);
target.pathname = `/${name}`;
const admin = createDatabase(source.href);
let created = false;
let db: ReturnType<typeof createDatabase> | undefined;
const run = (args: string[]) =>
  execFileSync("pnpm", args, {
    env: { ...process.env, DATABASE_URL: target.href, DIRECT_URL: target.href },
    stdio: "pipe",
  });
try {
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  created = true;
  run(["--filter", "@agentinfra/db", "migrate"]);
  db = createDatabase(target.href);
  const oldName = "20260917120000_multichannel_attachments",
    newName = "20260917160000_multichannel_attachments";
  const [before] = await db.$queryRaw<
    { id: string; checksum: string; finished_at: Date }[]
  >`SELECT id, checksum, finished_at FROM "_prisma_migrations" WHERE migration_name = ${newName}`;
  assert(before);
  await db.$queryRaw`SELECT "maxProviderMicrosPerMms" FROM "SmsRate" LIMIT 0`;
  await db.$queryRaw`SELECT "smsMessageId" FROM "Attachment" LIMIT 0`;
  // Simulate an existing installation that applied the original name after billing.
  await db.$executeRaw`UPDATE "_prisma_migrations" SET migration_name = ${oldName} WHERE id = ${before.id}`;
  run(["--filter", "@agentinfra/db", "migrate"]);
  const [after] = await db.$queryRaw<
    { id: string; checksum: string; finished_at: Date }[]
  >`SELECT id, checksum, finished_at FROM "_prisma_migrations" WHERE migration_name = ${newName}`;
  assert.deepEqual(
    after,
    before,
    "Normalization must preserve applied SQL history",
  );
  run(["--filter", "@agentinfra/db", "migrate"]);
  await db.$executeRaw`UPDATE "_prisma_migrations" SET migration_name = ${oldName}, checksum = 'unexpected' WHERE id = ${before.id}`;
  assert.throws(() => run(["exec", "tsx", "scripts/prepare-db-migrations.ts"]));
  const [unchanged] = await db.$queryRaw<
    { migration_name: string; checksum: string }[]
  >`SELECT migration_name, checksum FROM "_prisma_migrations" WHERE id = ${before.id}`;
  assert.deepEqual(unchanged, {
    migration_name: oldName,
    checksum: "unexpected",
  });
  console.log(
    "Fresh migrations, existing-history normalization, repeat runs, and checksum mismatch rejection passed.",
  );
} finally {
  await db?.$disconnect();
  if (created)
    await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.$disconnect();
}
