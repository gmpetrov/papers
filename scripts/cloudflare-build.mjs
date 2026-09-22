import { execFileSync } from "node:child_process";
const target = process.argv[2];
if (!["web", "jobs"].includes(target)) throw new Error("Expected web or jobs");
const env = {
  ...process.env,
  NEXT_PUBLIC_APP_URL: "https://www.papers.bot",
  BETTER_AUTH_URL: "https://www.papers.bot",
  MINTLIFY_DOCS_ORIGIN:
    process.env.MINTLIFY_DOCS_ORIGIN || "https://papers.mintlify.site",
};
const run = (args) => execFileSync("pnpm", args, { stdio: "inherit", env });
run(["db:generate"]);
run(["typecheck"]);
if (target === "web") {
  run([
    "--filter",
    "@agentinfra/web",
    "exec",
    "opennextjs-cloudflare",
    "build",
    "--config",
    "wrangler.production.jsonc",
  ]);
} else {
  run([
    "exec",
    "wrangler",
    "deploy",
    "--config",
    "apps/jobs/wrangler.production.jsonc",
    "--dry-run",
  ]);
}
