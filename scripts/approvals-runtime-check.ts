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
const ids: string[] = [];
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
  const org = await db.organization.findUniqueOrThrow({
    where: { id: organizationId },
  });
  for (const action of ["approve", "deny"]) {
    const row = await db.approval.create({
      data: {
        organizationId,
        principalId: "runtime-fixture:" + crypto.randomUUID(),
        route: action === "approve" ? "email.send:fixture" : "sms.send:fixture",
        key: action,
        requestHash: "fixture",
        parameters: {
          to: action === "approve" ? ["review@example.test"] : "+12025550188",
          ...(action === "approve" ? { from: "inbox@example.test", subject: "Review email subject" } : {}),
          text: 'Test only: <img src=x onerror="alert(1)">',
        },
        resourceId: "fixture-number",
        policyVersion: org.policyVersion,
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    ids.push(row.id);
  }
  // Push the two actionable fixtures beyond the first page.
  for (let i = 0; i < 26; i++) {
    const row = await db.approval.create({ data: {
      organizationId, principalId: "runtime-pagination", route: "sms.send:fixture",
      key: crypto.randomUUID(), requestHash: "fixture", parameters: { to: "+12025550188", text: "Pagination fixture" },
      resourceId: "fixture-number", policyVersion: org.policyVersion,
      status: "denied", expiresAt: new Date(Date.now() + 60000),
    } });
    ids.push(row.id);
  }
  const creationIds: string[] = [];
  for (const [route, parameters] of [
    ["inbox.create", { address: "requested@example.test", name: "Requested inbox" }],
    ["number.provision", { phoneNumber: "+12025550187", country: "US", upfrontCost: "1.00", monthlyCost: "2.00", currency: "USD" }],
  ] as const) {
    const row = await db.approval.create({ data: {
      organizationId, principalId: "runtime-provisioning", route,
      key: crypto.randomUUID(), requestHash: "fixture", parameters,
      resourceId: "fixture-resource", policyVersion: org.policyVersion,
      expiresAt: new Date(Date.now() + 60000),
    } });
    ids.push(row.id);
    creationIds.push(row.id);
  }
  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  await page.goto(`${origin}/dashboard/approvals`);
  await page.getByRole("button", { name: "Load older requests" }).click();
  const first = page.getByRole("article", { name: `Approval ${ids[0]}` });
  const second = page.getByRole("article", { name: `Approval ${ids[1]}` });
  await expect(
    first.getByText('Test only: <img src=x onerror="alert(1)">', {
      exact: true,
    }),
  ).toBeVisible();
  expect(await first.locator("img").count()).toBe(0);
  await expect(first.getByText("Subject: Review email subject")).toBeVisible();
  await expect(first.getByText("From: inbox@example.test")).toBeVisible();
  await first.getByRole("button", { name: "Approve this email" }).click();
  await page.getByRole("button", { name: "Load older requests" }).click();
  await expect(first.getByText(/Status: approved/)).toBeVisible();
  await second.getByRole("button", { name: "Deny", exact: true }).click();
  await page.getByRole("button", { name: "Load older requests" }).click();
  await expect(second.getByText(/Status: denied/)).toBeVisible();
  expect(
    (await db.approval.findUniqueOrThrow({ where: { id: ids[0] } }))
      .operationId,
  ).toBeNull();
  const purchase = page.getByRole("article", { name: `Approval ${creationIds[1]}` });
  await expect(purchase.getByText(/Upfront: 1.00 USD · Monthly: 2.00 USD/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create inbox requested@example.test" })).toBeVisible();
  await purchase.getByRole("button", { name: "Approve this creation" }).click();
  await expect(purchase.getByText(/Status: approved/)).toBeVisible();
  expect((await db.approval.findUniqueOrThrow({ where: { id: creationIds[1] } })).operationId).toBeNull();
  await purchase.screenshot({ path: "test-results/provisioning-approval.png" });
  await page.screenshot({ path: "test-results/approvals.png", fullPage: true });
  await page.goto(`${origin}/dashboard/settings`);
  await expect(
    page.getByLabel(
      "Require human approval for SMS sent through API keys or connected applications",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Require human approval for emails sent through API keys or connected applications")).toBeVisible();
  await expect(page.getByLabel("Require human approval for inboxes and phone numbers created through API keys or connected applications")).toBeVisible();
  console.log(
    "Approval review, exact untrusted text display, approve/deny decisions, and owner policy control passed. No SMS sent.",
  );
} finally {
  await db.approval.deleteMany({ where: { id: { in: ids } } });
  await api
    .post("/api/auth/sign-out", { timeout: 5000 })
    .catch(() => undefined);
  await api.dispose();
  await browser.close();
  await db.$disconnect();
}
