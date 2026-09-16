import { chromium, expect, request } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createDatabase } from "../packages/db/src/index";
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
const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra",
);
const browser = await chromium.launch();
let numberId: string | undefined;
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
  const organizationId = organizations[0].id;
  expect(
    (
      await api.post("/api/auth/organization/set-active", {
        data: { organizationId },
      })
    ).status(),
  ).toBe(200);
  const number = await db.phoneNumber.create({
    data: {
      organizationId,
      phoneNumber: "+12025550189",
      messagingProfileId: "usage-fixture",
      status: "active",
    },
  });
  numberId = number.id;
  const sms = await db.smsMessage.create({
    data: {
      organizationId,
      phoneNumberId: number.id,
      from: "+12025550188",
      to: number.phoneNumber,
      direction: "inbound",
      status: "received",
      text: "Temporary usage display fixture",
      segments: 3,
      costAmount: "0.0153000001",
      costCurrency: "USD",
    },
  });
  const result = await api.get(`/v1/sms/${sms.id}`);
  expect(result.status()).toBe(200);
  expect(await result.json()).toMatchObject({
    segments: 3,
    costAmount: "0.0153000001",
    costCurrency: "USD",
    recipientOptOut: { status: "unknown", observedAt: null },
  });
  await db.providerSmsOptOut.create({
    data: {
      messagingProfileId: "usage-fixture",
      recipient: "+12025550188",
      optedOut: true,
      occurredAt: new Date(),
      eventId: "usage-fixture",
    },
  });
  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await page.goto(`${origin}/dashboard/numbers`);
  await page
    .getByRole("button", { name: `View SMS for ${number.phoneNumber}` })
    .click();
  await page.getByRole("button", { name: "+12025550188", exact: true }).click();
  await expect(
    page.getByText("Segments: 3 · Provider cost: 0.0153000001 USD", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(/Blocked — recipient opted out/)).toBeVisible();
  await page.screenshot({ path: "test-results/sms-usage.png", fullPage: true });
  await page.goto(`${origin}/dashboard/usage`);
  await expect(
    page.getByRole("heading", { name: "Workspace usage", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "SMS usage", exact: true }),
  ).toBeVisible();
  const summary = await (
    await api.get(
      `/v1/workspace/usage?month=${new Date().toISOString().slice(0, 7)}`,
    )
  ).json();
  const usd = summary.sms.find(
    (row: { currency: string | null; direction: string }) =>
      row.currency === "USD" && row.direction === "inbound",
  );
  expect(usd.messagesWithCost).toBeGreaterThan(0);
  await expect(
    page.getByRole("cell", { name: usd.reportedProviderCost, exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/workspace-usage.png",
    fullPage: true,
  });
  await db.smsMessage.update({
    where: { id: sms.id },
    data: { costAmount: null, costCurrency: null, segments: null },
  });
  const unknown = await (await api.get(`/v1/sms/${sms.id}`)).json();
  expect(unknown).toMatchObject({
    segments: null,
    costAmount: null,
    costCurrency: null,
  });
  console.log(
    "SMS exact decimal usage, unknown values, and dashboard display passed through the development tunnel. No SMS sent.",
  );
} finally {
  await db.providerSmsOptOut.deleteMany({
    where: { messagingProfileId: "usage-fixture", recipient: "+12025550188" },
  });
  if (numberId) {
    await db.smsMessage.deleteMany({ where: { phoneNumberId: numberId } });
    await db.phoneNumber.delete({ where: { id: numberId } });
  }
  await api
    .post("/api/auth/sign-out", { timeout: 5000 })
    .catch(() => undefined);
  await api.dispose();
  await browser.close();
  await db.$disconnect();
}
