import { chromium, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
const env = Object.fromEntries(
  (await readFile(".env.e2e", "utf8"))
    .trim()
    .split("\n")
    .map((line) => line.split("=")),
);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  page.setDefaultTimeout(30000);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.abort(),
  );
  await page.goto("https://dev.chaindesk.ai/login", {
    waitUntil: "domcontentloaded",
  });
  await page.locator('[data-auth-ready="true"]').waitFor();
  await page.getByLabel("Email address").fill(env.TEST_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(env.TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard", { waitUntil: "domcontentloaded" });
  await page.goto("https://dev.chaindesk.ai/dashboard/numbers", {
    waitUntil: "domcontentloaded",
  });
  await page.locator('[data-dashboard-ready="true"]').waitFor();
  const select = page.getByLabel("Organization", { exact: true });
  if (!(await select.inputValue()))
    await select.selectOption(
      await select.locator("option").nth(1).getAttribute("value"),
    );
  await page.getByRole("button", { name: "Get a number", exact: true }).click();
  await page
    .getByRole("button", { name: "Search numbers", exact: true })
    .click();
  const choices = page.getByRole("button", { name: /^Select \+/ });
  await expect(choices.first()).toBeVisible();
  expect(await choices.count()).toBeGreaterThan(0);
  await expect(
    page.getByRole("link", { name: "Agents", exact: true }),
  ).toHaveCount(0);
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/telnyx-live-search.png",
    fullPage: true,
  });
  const capabilities = await (
    await page.request.get("https://dev.chaindesk.ai/v1/capabilities")
  ).json();
  expect(capabilities.phone.available).toBe(true);
  const unsigned = await page.request.post(
    "https://dev.chaindesk.ai/api/webhooks/telnyx",
    { data: {} },
  );
  expect(unsigned.status()).toBe(400);
  expect((await unsigned.json()).error).toBe("invalid_signature");
  console.log(
    JSON.stringify({
      liveSearch: true,
      choices: await choices.count(),
      phoneActive: true,
      webhookRejectsUnsignedRequests: true,
      purchases: 0,
      messagesSent: 0,
    }),
  );
} finally {
  await browser.close();
}
