import { chromium } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
const env = Object.fromEntries(
  (await readFile(".env.e2e", "utf8"))
    .trim()
    .split("\n")
    .map((l) => l.split("=")),
);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.setDefaultTimeout(20000);
await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
const errors = [];
page.on("pageerror", (e) => {
  errors.push(e.message);
  console.log("Browser error:", e.message);
});
await mkdir("test-results", { recursive: true });
await page.goto("https://dev.chaindesk.ai", { waitUntil: "domcontentloaded" });
await page.screenshot({ path: "test-results/landing.png", fullPage: true });
await page.goto("https://dev.chaindesk.ai/login", {
  waitUntil: "domcontentloaded",
});
await page.locator('form[data-auth-ready="true"]').waitFor();
await page.getByLabel("Email address").fill(env.TEST_EMAIL);
await page.getByLabel("Password", { exact: true }).fill(env.TEST_PASSWORD);
await page.getByRole("button", { name: "Sign in", exact: true }).click();
await page.waitForURL("**/dashboard", {
  timeout: 20000,
  waitUntil: "domcontentloaded",
});
await page.waitForLoadState("domcontentloaded");
if (await page.getByLabel("Workspace name").isVisible()) {
  await page.getByLabel("Workspace name").fill("Development workspace");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("heading", { name: /Good to see you/ }).waitFor();
}
await page.goto("https://dev.chaindesk.ai/dashboard/agents", {
  waitUntil: "domcontentloaded",
});
await page.getByText("Loading your workspace…").waitFor({ state: "hidden" });
await page.waitForURL("**/dashboard/inboxes");
if (await page.getByRole("link", { name: "Agents", exact: true }).count())
  throw new Error("Agents navigation is still present");
await page.goto("https://dev.chaindesk.ai/dashboard/inboxes", {
  waitUntil: "domcontentloaded",
});
await page.getByText("Loading your workspace…").waitFor({ state: "hidden" });
await page
  .getByRole("button", { name: "Create inbox", exact: true })
  .first()
  .click();
if (await page.getByLabel("Agent", { exact: true }).count())
  throw new Error("Inbox requires an agent");
await page.screenshot({ path: "test-results/create-inbox.png" });
await page.getByLabel("Name (optional)", { exact: true }).fill("");
await page
  .getByLabel("Username (before @papers.bot)", { exact: true })
  .fill("dev-check-" + Date.now());
await page.getByRole("button", { name: "Create", exact: true }).click();
await page.getByRole("dialog").waitFor({ state: "hidden" });
await page.getByText("Loading your workspace…").waitFor({ state: "hidden" });
await page.screenshot({ path: "test-results/dashboard.png", fullPage: true });
await page.goto("https://dev.chaindesk.ai/dashboard/settings", {
  waitUntil: "domcontentloaded",
});
await page.getByRole("heading", { name: "Workspace members" }).waitFor();
await page.setViewportSize({ width: 390, height: 844 });
await page.goto("https://dev.chaindesk.ai/dashboard", {
  waitUntil: "domcontentloaded",
});
await page.getByText("Loading your workspace…").waitFor({ state: "hidden" });
await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
console.log(
  JSON.stringify({
    browserErrors: errors,
    completed: [
      "landing",
      "sign-in",
      "organization",
      "legacy-agents-redirect",
      "inbox",
      "settings",
      "mobile",
    ],
  }),
);
await browser.close();
