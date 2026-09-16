import { createDatabase } from "../packages/db/src/index";
import { chromium, request, expect } from "@playwright/test";
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
const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra",
);
let id: string | undefined;
const name = `Dashboard webhook check ${Date.now()}`;
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
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  await page.goto(`${origin}/dashboard/integrations`);
  const panel = page.getByRole("region", { name: "Webhooks", exact: true });
  await expect(
    panel.getByRole("button", { name: "Add endpoint" }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Add endpoint" }).click();
  await panel.getByLabel("Name", { exact: true }).fill(name);
  await panel
    .getByLabel("Endpoint URL")
    .fill("https://hooks.example.com/events");
  await panel
    .getByRole("button", { name: "Create endpoint", exact: true })
    .click();
  await expect(
    panel.getByText("Save your signing secret", { exact: true }),
  ).toBeVisible();
  const listing = await (await api.get("/v1/webhook-endpoints")).json();
  id = listing.data.find((row: { name: string }) => row.name === name)?.id;
  expect(id).toBeTruthy();
  await db.webhookDelivery.create({
    data: {
      endpointId: id!,
      eventId: "dashboard-fixture",
      url: "https://hooks.example.com/events",
      body: "{}",
      status: "failed",
      attempts: 1,
      lastStatusCode: 503,
      lastError: "http_error",
      logs: {
        create: {
          attempt: 1,
          statusCode: 503,
          error: "http_error",
          finishedAt: new Date(),
        },
      },
    },
  });
  await panel.getByRole("button", { name: "I saved it" }).click();
  expect(
    (
      await api.patch(`/v1/webhook-endpoints/${id}`, {
        data: { eventTypes: ["inbox.runtime_test"] },
      })
    ).status(),
  ).toBe(200);
  await panel.getByRole("button", { name: "Enable", exact: true }).click();
  await expect(
    panel.getByText(`${name} · Enabled`, { exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Disable", exact: true }).click();
  await expect(
    panel.getByText(`${name} · Disabled`, { exact: true }),
  ).toBeVisible();
  const row = panel
    .locator("div")
    .filter({ has: page.getByText(`${name} · Disabled`, { exact: true }) })
    .filter({ has: page.getByRole("button", { name: "Edit", exact: true }) })
    .last();
  await row
    .getByRole("button", { name: "Delivery history", exact: true })
    .click();
  await expect(
    panel.getByText("failed · http_error", { exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "View attempts" }).click();
  await expect(
    panel.getByRole("listitem").filter({ hasText: "503 · http_error" }),
  ).toBeVisible();
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  await panel.getByLabel("Name", { exact: true }).fill(name + " edited");
  await panel
    .getByRole("button", { name: "Save endpoint", exact: true })
    .click();
  await expect(
    panel.getByText(`${name} edited · Disabled`, { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/webhook-dashboard.png",
    fullPage: true,
  });
  const historyResponse = await api.get(
    `/v1/webhook-endpoints/${id}/deliveries`,
  );
  expect(historyResponse.status()).toBe(200);
  expect((await historyResponse.json()).data).toHaveLength(1);
  console.log(
    "Webhook dashboard creation, one-time secret display, editing, and delivery history passed. No callbacks sent.",
  );
} finally {
  if (!id) {
    const response = await api.get("/v1/webhook-endpoints");
    if (response.ok())
      id = (await response.json()).data.find(
        (row: { name: string }) =>
          row.name === name || row.name === name + " edited",
      )?.id;
  }
  if (id) await api.delete(`/v1/webhook-endpoints/${id}`);
  await api.post("/api/auth/sign-out");
  await api.dispose();
  await browser.close();
  await db.$disconnect();
}
