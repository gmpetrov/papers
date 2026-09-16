import { createDatabase } from "../packages/db/src/index";
import { TelnyxProvider } from "../packages/providers/src/index";
import { importSmsOptOuts } from "../packages/core/src/sms-opt-out-import";
const {
  DATABASE_URL,
  TELNYX_API_KEY,
  TELNYX_STATUS,
  TELNYX_MESSAGING_PROFILE_ID,
} = process.env;
if (
  !DATABASE_URL ||
  !TELNYX_API_KEY ||
  TELNYX_STATUS !== "active" ||
  !TELNYX_MESSAGING_PROFILE_ID
)
  throw new Error("Database and active Telnyx configuration are required");
const db = createDatabase(DATABASE_URL);
try {
  const result = await importSmsOptOuts(
    db,
    new TelnyxProvider(TELNYX_API_KEY, TELNYX_STATUS),
    TELNYX_MESSAGING_PROFILE_ID,
  );
  console.log(JSON.stringify(result));
  if (!result.complete) process.exitCode = 1;
} catch {
  // Never print provider payloads, phone numbers, credentials, or Prisma errors.
  console.error(
    "Opt-out import failed. Previously imported pages remain saved; rerunning is safe.",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
