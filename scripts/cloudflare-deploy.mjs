import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
const target = process.argv[2];
if (!["web", "jobs"].includes(target)) throw new Error("Expected web or jobs");
if (process.env.WORKERS_CI_BRANCH !== "main")
  throw new Error("Production deployment requires a main-branch Workers Build");
if (!process.env.DATABASE_URL)
  throw new Error("Missing DATABASE_URL build secret");
const run = (args, capture = false) =>
  new Promise((resolve, reject) => {
    const child = spawn("pnpm", args, {
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      env: process.env,
    });
    let output = "";
    if (capture) {
      for (const stream of [child.stdout, child.stderr])
        stream.on("data", (chunk) => {
          output += chunk;
          process.stdout.write(chunk);
        });
    }
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            Object.assign(new Error(`Deployment step failed (${code})`), {
              output,
            }),
          ),
    );
  });
// Prisma serializes migrations. Retry only lock contention from the other build;
// SQL errors and failed migrations must stop deployment immediately.
for (let attempt = 1; attempt <= 6; attempt++) {
  try {
    await run(["--filter", "@agentinfra/db", "migrate"], true);
    break;
  } catch (error) {
    if (
      attempt === 6 ||
      !/P1002/.test(error.output ?? "") ||
      !/advisory lock/i.test(error.output ?? "")
    )
      throw error;
    console.log("Another build is migrating; retrying in 15 seconds");
    await setTimeout(15000);
  }
}
await run([
  "exec",
  "wrangler",
  "deploy",
  "--config",
  `apps/${target}/wrangler.production.jsonc`,
]);
if (target === "web")
  await run(["exec", "node", "scripts/production-health-check.mjs"]);
