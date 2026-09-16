import { createDatabase } from "../packages/db/src/index";
import { getBackgroundHealth } from "../packages/core/src/background-health";

// Explicit database environment; no default and no provider configuration needed.
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required for the operator status check");
  process.exit(1);
}
const db = createDatabase(process.env.DATABASE_URL);
try {
  const result = await getBackgroundHealth(db);
  console.log(JSON.stringify(result, null, 2));
  if (result.needsAttention) process.exitCode = 2;
} catch {
  console.error(
    "Background status check failed; verify database access and migrations",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
