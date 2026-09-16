import { hashPassword } from "better-auth/crypto";
import { createDatabase } from "@agentinfra/db";
import { writeFile } from "node:fs/promises";
const databaseUrl = new URL(process.env.DATABASE_URL!);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(databaseUrl.hostname) ||
  process.env.NODE_ENV === "production"
)
  throw new Error(
    "The development fixture requires a local database and non-production environment.",
  );
const db = createDatabase(process.env.DATABASE_URL!);
const email = "local-test@papers.invalid";
const password = crypto.randomUUID();
const user = await db.user.upsert({
  where: { email },
  create: {
    id: crypto.randomUUID(),
    email,
    name: "Local Test",
    emailVerified: true,
  },
  update: {},
});
const account = await db.account.findFirst({
  where: { userId: user.id, providerId: "credential" },
});
const data = { password: await hashPassword(password) };
if (account) await db.account.update({ where: { id: account.id }, data });
else
  await db.account.create({
    data: {
      id: crypto.randomUUID(),
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      ...data,
    },
  });
await writeFile(
  ".env.e2e",
  `TEST_EMAIL=${email}\nTEST_PASSWORD=${password}\n`,
  { mode: 0o600 },
);
await db.$disconnect();
console.log(
  "Local test fixture ready (credentials stored in ignored .env.e2e)",
);
