/** Operator-only: use an account rate deck that includes carrier fees. */
import { createDatabase } from "../packages/db/src/index";
import { usdMicros } from "../packages/core/src/billing-ledger";
const [prefix, providerCeilingUSD, expiry, ...reason] = process.argv.slice(2);
if (
  !prefix ||
  !/^\+[1-9]\d{0,14}$/.test(prefix) ||
  !providerCeilingUSD ||
  !expiry ||
  !reason.length
)
  throw new Error(
    'Usage: set-sms-rate.ts +1202 0.21 2026-09-24T00:00:00Z "Source and covered sender type"',
  );
const amount = usdMicros(providerCeilingUSD);
const expiresAt = new Date(expiry);
if (
  amount <= 0n ||
  !Number.isFinite(expiresAt.getTime()) ||
  expiresAt <= new Date() ||
  expiresAt.getTime() > Date.now() + 31 * 86400000
)
  throw new Error(
    "Use a positive verified USD ceiling and an expiry within 31 days",
  );
const db = createDatabase(process.env.DATABASE_URL!);
try {
  await db.smsRate.upsert({
    where: { prefix },
    create: {
      prefix,
      maxProviderMicrosPerSegment: amount,
      expiresAt,
      note: reason.join(" "),
    },
    update: {
      maxProviderMicrosPerSegment: amount,
      expiresAt,
      note: reason.join(" "),
    },
  });
  console.log(JSON.stringify({ prefix, providerCeilingUSD, expiresAt }));
} finally {
  await db.$disconnect();
}
