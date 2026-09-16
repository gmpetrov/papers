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
  let status = "under_review";
  let numberStatus = "active";
  const purchaseKeys = [];
  const releaseKeys = [];
  const sendKeys = [];
  await page.route("**/v1/phone-numbers**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/phone-numbers/available") {
      await route.fulfill({
        json: {
          data: [
            {
              phone_number: "+12025550102",
              cost_information: {
                upfront_cost: "1.00000",
                monthly_cost: "1.00000",
                currency: "USD",
              },
            },
          ],
        },
      });
      return;
    }
    if (
      url.pathname === "/v1/phone-numbers" &&
      route.request().method() === "POST"
    ) {
      purchaseKeys.push(route.request().headers()["idempotency-key"]);
      expect(route.request().postDataJSON()).toEqual({
        phoneNumber: "+12025550102",
        country: "US",
        upfrontCost: "1.00000",
        monthlyCost: "1.00000",
        currency: "USD",
      });
      await route.fulfill(
        purchaseKeys.length === 1
          ? {
              status: 503,
              json: { error: { message: "Temporary purchase failure" } },
            }
          : { status: 202, json: { id: "purchase", status: "unknown" } },
      );
      return;
    }
    if (route.request().method() === "DELETE") {
      releaseKeys.push(route.request().headers()["idempotency-key"]);
      numberStatus = "released";
      await route.fulfill({ json: { id: "release", status: "completed" } });
      return;
    }
    if (route.request().method() === "POST") {
      sendKeys.push(route.request().headers()["idempotency-key"]);
      await route.fulfill({
        status: sendKeys.length === 1 ? 503 : 202,
        contentType: "application/json",
        body: JSON.stringify(
          sendKeys.length === 1
            ? { error: { message: "Temporary request failure" } }
            : {
                id: "sms-operation",
                status: "unknown",
                failure: {
                  kind: "provider_http_error",
                  httpStatus: 429,
                  providerCodes: ["10011"],
                },
                messageId: "fixture-message",
              },
        ),
      });
      return;
    }
    const message = (id) => ({
      id,
      from: "+12025550100",
      to: "+12025550101",
      direction: "inbound",
      status: "received",
      createdAt: "2026-09-16T10:00:00Z",
    });
    const data = url.pathname.endsWith("/messages")
      ? {
          data: [message(url.searchParams.has("cursor") ? "older" : "latest")],
          nextCursor: url.searchParams.has("cursor") ? null : "latest",
        }
      : {
          data: [
            {
              id: "fixture-number",
              agentId: "fixture-agent",
              phoneNumber: "+12025550101",
              status: numberStatus,
            },
          ],
          status,
        };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  await page.route("**/v1/sms/*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "latest",
        from: "+12025550100",
        to: "+12025550101",
        direction: "inbound",
        status: "received",
        createdAt: "2026-09-16T10:00:00Z",
        text: "Hello from the SMS fixture. <script>window.smsExecuted=true</script>",
        contentTrust: "untrusted",
      }),
    }),
  );
  await page.route("**/v1/operations/purchase", (route) =>
    route.fulfill({ json: { id: "purchase", status: "completed" } }),
  );
  await page.route("**/v1/operations/sms-operation", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ id: "sms-operation", status: "completed" }),
    }),
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
  if (!(await select.inputValue())) {
    const value = await select.locator("option").nth(1).getAttribute("value");
    await select.selectOption(value);
  }
  await page.getByRole("button", { name: "View SMS for +12025550101" }).click();
  await expect(
    page.getByRole("button", { name: "Compose SMS", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Load older messages" }).click();
  await expect(
    page.getByRole("button", { name: "+12025550100", exact: true }),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "+12025550100", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("External message content", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Hello from the SMS fixture.", { exact: false }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.smsExecuted)).toBeUndefined();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/sms-dashboard.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "All numbers", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "View SMS for +12025550101" }),
  ).toBeVisible();
  status = "active";
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("button", { name: "View SMS for +12025550101" }).click();
  await page.getByRole("button", { name: "Compose SMS", exact: true }).click();
  await page.getByLabel("Recipient phone number").fill("+12025550100");
  await page
    .getByLabel("Message", { exact: true })
    .fill("Fixture SMS, not sent externally");
  await page.getByRole("button", { name: "Send SMS", exact: true }).click();
  await expect(
    page.getByText("Temporary request failure", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Send SMS", exact: true }).click();
  await expect(
    page.getByText("The send outcome is not confirmed yet.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Provider HTTP status: 429")).toBeVisible();
  await expect(page.getByText("Telnyx error codes: 10011")).toBeVisible();
  expect(sendKeys).toHaveLength(2);
  expect(sendKeys[0]).toBe(sendKeys[1]);
  await page
    .getByRole("button", { name: "Check send status", exact: true })
    .click();
  await expect(
    page.getByText("Telnyx accepted the SMS.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New SMS", exact: true }).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "All numbers", exact: true }).click();
  await page.getByRole("button", { name: "Get a number", exact: true }).click();
  await page
    .getByRole("button", { name: "Search numbers", exact: true })
    .click();
  await page.getByRole("button", { name: "Select +12025550102" }).click();
  await expect(page.getByText(/1.00 upfront/)).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm purchase", exact: true })
    .click();
  await expect(page.getByText("Temporary purchase failure")).toBeVisible();
  await page
    .getByRole("button", { name: "Retry purchase status", exact: true })
    .click();
  await expect(
    page.getByText(/Your purchase is being confirmed/),
  ).toBeVisible();
  expect(purchaseKeys).toHaveLength(2);
  expect(purchaseKeys[0]).toBe(purchaseKeys[1]);
  await page
    .getByRole("button", { name: "Check purchase status", exact: true })
    .click();
  await expect(page.getByText("Your number is ready.")).toBeVisible();
  await page.getByRole("button", { name: "Close search", exact: true }).click();
  await page.getByRole("button", { name: "View SMS for +12025550101" }).click();
  await page
    .getByRole("button", { name: "Release number", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm release", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Phone number to release").fill("+12025550101");
  await page
    .getByRole("button", { name: "Confirm release", exact: true })
    .click();
  await expect(
    page.getByText("Number released.", { exact: true }),
  ).toBeVisible();
  expect(releaseKeys).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: "Compose SMS", exact: true }),
  ).toHaveCount(0);
  console.log(
    "Phone dashboard listing, pagination, safe SMS rendering, navigation, gated composer, retry keys, status polling, priced purchases, and release confirmation passed (mocked phone API).",
  );
} finally {
  await browser.close();
}
