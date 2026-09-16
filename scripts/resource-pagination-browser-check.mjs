import { chromium, expect, request } from "@playwright/test";
import { readFile } from "node:fs/promises";

const fixture = Object.fromEntries(
  (await readFile(".env.e2e", "utf8"))
    .trim()
    .split("\n")
    .map((line) => line.split("=")),
);
const origin = "https://dev.chaindesk.ai";
const api = await request.newContext({
  baseURL: origin,
  extraHTTPHeaders: { Origin: origin },
});
const browser = await chromium.launch();
try {
  expect(
    (
      await api.post("/api/auth/sign-in/email", {
        data: { email: fixture.TEST_EMAIL, password: fixture.TEST_PASSWORD },
      })
    ).status(),
  ).toBe(200);
  const organizations = await (
    await api.get("/api/auth/organization/list")
  ).json();
  expect(
    (
      await api.post("/api/auth/organization/set-active", {
        data: { organizationId: organizations[0].id },
      })
    ).status(),
  ).toBe(200);
  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let inboxAttempt = 0;
  const inbox = (id) => ({
    id,
    name: `Inbox ${id}`,
    address: `${id}@example.test`,
    status: "active",
    createdAt: new Date().toISOString(),
    _count: { messages: 0 },
  });
  await page.route("**/v1/inboxes*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/v1/inboxes") return route.continue();
    if (!url.searchParams.has("cursor"))
      return route.fulfill({
        json: { data: [inbox("first")], nextCursor: "next/+&" },
      });
    expect(url.searchParams.get("cursor")).toBe("next/+&");
    if (++inboxAttempt === 1)
      return route.fulfill({
        status: 503,
        json: { error: { message: "Temporary listing failure" } },
      });
    return route.fulfill({
      json: { data: [inbox("first"), inbox("second")], nextCursor: null },
    });
  });
  await page.goto(`${origin}/dashboard/inboxes`);
  await page
    .getByRole("button", { name: "Load more inboxes", exact: true })
    .click();
  await expect(
    page.getByText("Temporary listing failure", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "first@example.test" }),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "Load more inboxes", exact: true })
    .click();
  await expect(
    page.getByRole("row").filter({ hasText: "second@example.test" }),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "first@example.test" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Load more inboxes", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: "test-results/inbox-pagination.png" });
  let messageAttempt = 0;
  const message = (id) => ({
    id,
    from: "sender@example.test",
    subject: `Message ${id}`,
    direction: "inbound",
    status: "received",
  });
  await page.route("**/v1/inboxes/first/messages*", async (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has("cursor"))
      return route.fulfill({
        json: { data: [message("newest")], nextCursor: "older/+&" },
      });
    expect(url.searchParams.get("cursor")).toBe("older/+&");
    if (++messageAttempt === 1)
      return route.fulfill({
        status: 503,
        json: { error: { message: "Temporary message failure" } },
      });
    return route.fulfill({
      json: { data: [message("newest"), message("oldest")], nextCursor: null },
    });
  });
  await page.getByRole("row").filter({ hasText: "first@example.test" }).click();
  await page
    .getByRole("button", { name: "Load older messages", exact: true })
    .click();
  await expect(
    page.getByText("Temporary message failure", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Message newest", { exact: true })).toHaveCount(
    1,
  );
  await page
    .getByRole("button", { name: "Load older messages", exact: true })
    .click();
  await expect(page.getByText("Message oldest", { exact: true })).toBeVisible();
  await expect(page.getByText("Message newest", { exact: true })).toHaveCount(
    1,
  );
  await expect(
    page.getByRole("button", { name: "Load older messages", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: "test-results/email-pagination.png" });
  const number = (id, phoneNumber) => ({
    id,
    phoneNumber,
    status: "active",
    agentId: null,
  });
  await page.route("**/v1/phone-numbers*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/v1/phone-numbers") return route.continue();
    const first = number("first", "+12025550101");
    if (!url.searchParams.has("cursor"))
      return route.fulfill({
        json: { data: [first], status: "active", nextCursor: "phone/+&" },
      });
    expect(url.searchParams.get("cursor")).toBe("phone/+&");
    return route.fulfill({
      json: {
        data: [first, number("second", "+12025550102")],
        status: "active",
        nextCursor: null,
      },
    });
  });
  await page.goto(`${origin}/dashboard/numbers`);
  await page
    .getByRole("button", { name: "Load more phone numbers", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "View SMS for +12025550102",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "View SMS for +12025550101",
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Load more phone numbers", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: "test-results/number-pagination.png" });
  expect(errors).toEqual([]);
  console.log(
    "Dashboard inbox, email history, and phone pagination passed: cursor forwarding, append/deduplication, error retry, and final-page controls. Resource responses mocked; no provider calls.",
  );
} finally {
  await api.post("/api/auth/sign-out", { data: {} });
  await api.dispose();
  await browser.close();
}
