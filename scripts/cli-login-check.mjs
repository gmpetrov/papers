import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const directory = await mkdtemp(join(tmpdir(), "papers-cli-check-"));
const env = {
  ...process.env,
  PAPERS_CONFIG_DIR: directory,
  PAPERS_API_KEY: "",
  PAPERS_BASE_URL: "https://dev.chaindesk.ai",
};
const credentials = Object.fromEntries(
  (await readFile(".env.e2e", "utf8"))
    .trim()
    .split("\n")
    .map((line) => line.split("=")),
);
let authUrl;
const urlReady = new Promise((resolve) => (authUrl = resolve));
function run(args, onStderr) {
  const child = spawn(
    process.execPath,
    ["packages/cli/dist/index.js", ...args],
    { env },
  );
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    onStderr?.(stderr);
  });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(`CLI ${args[0]} failed (${code}): ${stderr}`)),
    );
  });
  return { child, done };
}
const login = run(
  ["login", "--no-browser", "--scope", "inboxes:read offline_access"],
  (text) => {
    const match = text.match(
      /https:\/\/[^\s]+\/api\/auth\/oauth2\/authorize\?[^\s]+/,
    );
    if (match) authUrl(match[0]);
  },
);
login.done.catch(() => {});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  const url = await Promise.race([
    urlReady,
    login.done.then(() => {
      throw new Error("No authorization URL");
    }),
  ]);
  await page.goto(url);
  await page.locator('[data-auth-ready="true"]').waitFor();
  await page.getByLabel("Email address").fill(credentials.TEST_EMAIL);
  await page
    .getByLabel("Password", { exact: true })
    .fill(credentials.TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/select-organization?**");
  await page
    .locator("#oauth-org option")
    .first()
    .waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL("**/consent?**");
  await page.getByRole("button", { name: "Allow access", exact: true }).click();
  assert.equal(JSON.parse(await login.done).loggedIn, true);
  assert.ok(JSON.parse(await run(["whoami"]).done).organizationId);
  const file = join(
    directory,
    (await readdir(directory)).find((name) => name.endsWith(".json")),
  );
  const stored = JSON.parse(await readFile(file, "utf8"));
  await writeFile(file, JSON.stringify({ ...stored, expiresAt: 0 }), {
    mode: 0o600,
  });
  assert.ok(JSON.parse(await run(["inboxes", "list"]).done).data);
  const refreshed = JSON.parse(await readFile(file, "utf8"));
  assert.notEqual(refreshed.accessToken, stored.accessToken);
  assert.equal(JSON.parse(await run(["logout"]).done).loggedOut, true);
  assert.equal((await readdir(directory)).length, 0);
  const revoked = await fetch("https://dev.chaindesk.ai/v1/me", {
    headers: { Authorization: `Bearer ${refreshed.accessToken}` },
  });
  assert.equal(revoked.status, 401);
  console.log(
    "CLI browser login, workspace consent, API access, refresh, and remote logout passed.",
  );
} finally {
  login.child.kill("SIGTERM");
  await run(["logout"]).done.catch(() => {});
  await browser.close();
  await rm(directory, { recursive: true, force: true });
}
