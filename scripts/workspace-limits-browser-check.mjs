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
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(30000);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.abort(),
  );
  let policy = {
    dailyEmailLimit: 100,
    dailySmsLimit: 100,
    maxInboxes: 10,
    maxPhoneNumbers: 5,
  };
  let saved = 0;
  await page.route("**/v1/workspace/policy", async (route) => {
    if (route.request().method() === "PATCH") {
      policy = route.request().postDataJSON();
      saved++;
    }
    await route.fulfill({
      json: {
        policy,
        usage: {
          day: "2026-09-16",
          emailSends: 7,
          smsSends: 2,
          inboxes: 3,
          phoneNumbers: 1,
        },
      },
    });
  });
  await page.goto("https://dev.chaindesk.ai/login", {
    waitUntil: "domcontentloaded",
  });
  await page.locator('[data-auth-ready="true"]').waitFor();
  await page.getByLabel("Email address").fill(env.TEST_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(env.TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard", { waitUntil: "domcontentloaded" });
  await page.goto("https://dev.chaindesk.ai/dashboard/settings", {
    waitUntil: "domcontentloaded",
  });
  await page.locator('[data-dashboard-ready="true"]').waitFor();
  const select = page.getByLabel("Organization", { exact: true });
  if (!(await select.inputValue()))
    await select.selectOption(
      await select.locator("option").nth(1).getAttribute("value"),
    );
  await expect(page.getByLabel("Emails per day")).toHaveValue("100");
  await expect(
    page.getByRole("button", { name: "Save limits" }),
  ).toBeDisabled();
  await page.getByLabel("Emails per day").fill("0");
  await page.getByLabel("Phone numbers", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save limits" }).click();
  await expect(page.getByRole("status")).toHaveText("Workspace limits saved.");
  expect(saved).toBe(1);
  expect(policy).toEqual({
    dailyEmailLimit: 0,
    dailySmsLimit: 100,
    maxInboxes: 10,
    maxPhoneNumbers: 2,
  });
  await expect(
    page.getByRole("button", { name: "Save limits" }),
  ).toBeDisabled();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/workspace-limits.png",
    fullPage: true,
  });
  console.log(
    "Workspace limits browser checks passed (mocked policy API; no live limits changed).",
  );
} finally {
  await browser.close();
}
