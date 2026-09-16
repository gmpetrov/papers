import { chromium, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { getPlatformProxy } from "wrangler";
import { createDatabase } from "../packages/db/src/index";
import { hash } from "../packages/core/src/errors";

const fixture = Object.fromEntries(
  (await readFile(".env.e2e", "utf8"))
    .trim()
    .split("\n")
    .map((line) => line.split("=")),
);
const db = createDatabase(process.env.DATABASE_URL!);
const platform = await getPlatformProxy<{
  ATTACHMENTS: {
    put(key: string, body: string): Promise<unknown>;
    delete(key: string): Promise<void>;
  };
}>({
  configPath: "apps/web/wrangler.jsonc",
  persist: { path: ".wrangler/shared" },
});
const browser = await chromium.launch({ headless: true });
const id = "r2-check-" + randomUUID();
const objectKey = `verification/${id}`;
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.abort(),
  );
  await page.goto("https://dev.chaindesk.ai/login", {
    waitUntil: "domcontentloaded",
  });
  await page.locator('[data-auth-ready="true"]').waitFor();
  await page.getByLabel("Email address").fill(fixture.TEST_EMAIL!);
  await page
    .getByLabel("Password", { exact: true })
    .fill(fixture.TEST_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard", { waitUntil: "domcontentloaded" });
  await page.locator('[data-dashboard-ready="true"]').waitFor();
  const select = page.getByLabel("Organization", { exact: true });
  if (!(await select.inputValue()))
    await select.selectOption(
      (await select.locator("option").nth(1).getAttribute("value"))!,
    );
  const meResponse = await page.request.get("https://dev.chaindesk.ai/v1/me");
  expect(meResponse.ok()).toBe(true);
  const me = await meResponse.json();
  await db.inbox.create({
    data: {
      id,
      name: "R2 verification fixture",
      organizationId: me.organizationId,
      address: `${id}@example.test`,
      status: "archived",
    },
  });
  await db.emailMessage.create({
    data: {
      id,
      organizationId: me.organizationId,
      inboxId: id,
      threadId: id,
      direction: "inbound",
      status: "received",
      from: "fixture@example.test",
      to: ["fixture@example.test"],
      subject: "R2 verification",
      attachments: {
        create: {
          id,
          providerId: id,
          filename: "verification.txt",
          contentType: "text/plain",
          size: 18,
          objectKey,
        },
      },
    },
  });
  await platform.env.ATTACHMENTS.put(objectKey, "private-r2-fixture");
  await db.attachment.create({
    data: {
      id: id + "-pending",
      messageId: id,
      providerId: id + "-pending",
      filename: "<img src=x onerror=alert(1)>.txt",
      contentType: "text/plain",
      size: 0,
    },
  });
  await page.goto("https://dev.chaindesk.ai/dashboard/inboxes", {
    waitUntil: "domcontentloaded",
  });
  await page.locator('[data-dashboard-ready="true"]').waitFor();
  await page.getByRole("row", { name: /R2 verification fixture/ }).click();
  await page
    .getByRole("cell", { name: "R2 verification", exact: true })
    .click();
  const attachments = page.getByRole("region", { name: "Email attachments" });
  await expect(
    attachments.getByText("Processing", { exact: true }),
  ).toBeVisible();
  await expect(attachments.locator("img")).toHaveCount(0);
  await expect(
    attachments.getByText("<img src=x onerror=alert(1)>.txt", { exact: true }),
  ).toBeVisible();
  await db.attachment.update({
    where: { id: id + "-pending" },
    data: { storageAttempts: 8 },
  });
  await attachments
    .getByRole("button", { name: "Refresh attachments" })
    .click();
  await expect(
    attachments.getByText("Download unavailable", { exact: true }),
  ).toBeVisible();
  const downloadUrl = `https://dev.chaindesk.ai/v1/attachments/${id}/download`;
  await page.route(downloadUrl, (route) =>
    route.fulfill({
      status: 409,
      json: { error: { message: "Attachment storage is pending" } },
    }),
  );
  await attachments
    .getByRole("button", { name: "Download verification.txt", exact: true })
    .click();
  await expect(attachments.getByRole("alert")).toHaveText(
    "Attachment storage is pending",
  );
  await page.unroute(downloadUrl);
  const receivedDownload = page.waitForEvent("download");
  await attachments
    .getByRole("button", { name: "Download verification.txt", exact: true })
    .click();
  const downloaded = await receivedDownload;
  expect(downloaded.suggestedFilename()).toBe("verification.txt");
  expect(await readFile((await downloaded.path())!, "utf8")).toBe(
    "private-r2-fixture",
  );
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/email-attachments.png",
    fullPage: true,
  });
  const response = await page.request.get(
    `https://dev.chaindesk.ai/v1/attachments/${id}/download`,
  );
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe("private-r2-fixture");
  expect(response.headers()["content-type"]).toBe("application/octet-stream");
  expect(response.headers()["content-disposition"]).toContain("attachment;");
  expect(response.headers()["cache-control"]).toContain("no-store");
  const key = randomUUID();
  await db.apiKey.create({
    data: {
      id,
      organizationId: me.organizationId,
      createdBy: me.userId,
      name: "Temporary MCP attachment verification",
      prefix: "fixture",
      hash: await hash(key),
      scopes: ["inboxes:read"],
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  const mcp = () =>
    page.request.post("https://dev.chaindesk.ai/mcp", {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json, text/event-stream",
      },
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "download_attachment",
          arguments: { attachmentId: id },
        },
      },
    });
  const mcpResponse = await mcp();
  expect(mcpResponse.status()).toBe(200);
  const mcpResult = (await mcpResponse.json()).result;
  expect(mcpResult.isError).not.toBe(true);
  expect(
    Buffer.from(mcpResult.content[1].resource.blob, "base64").toString(),
  ).toBe("private-r2-fixture");
  const linkResponse = await page.request.post("https://dev.chaindesk.ai/mcp", {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json, text/event-stream",
    },
    data: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "get_attachment_download_url",
        arguments: { attachmentId: id },
      },
    },
  });
  const linked = (await linkResponse.json()).result;
  expect(linked.isError).not.toBe(true);
  const link = linked.structuredContent.data.url;
  const downloadedLink = await fetch(link);
  expect(downloadedLink.status).toBe(200);
  expect(await downloadedLink.text()).toBe("private-r2-fixture");
  expect(downloadedLink.headers.get("referrer-policy")).toBe("no-referrer");
  await db.apiKey.update({ where: { id }, data: { scopes: [] } });
  expect((await mcp()).status()).toBe(403);
  expect((await fetch(link)).status).toBe(403);
  await db.apiKey.delete({ where: { id } });
  expect((await mcp()).status()).toBe(401);
  expect((await fetch(link)).status).toBe(401);
  const anonymous = await browser.newContext();
  expect(
    (
      await anonymous.request.get(
        `https://dev.chaindesk.ai/v1/attachments/${id}/download`,
      )
    ).status(),
  ).toBe(401);
  await anonymous.close();
  console.log(
    "Attachment UI, shared R2 download, remote MCP binary download, missing-scope denial, revoked-key denial, and anonymous rejection passed. No external email sent.",
  );
} finally {
  await browser.close();
  await db.apiKey.deleteMany({ where: { id } });
  await db.emailMessage.deleteMany({ where: { id } });
  await db.inbox.deleteMany({ where: { id } });
  await db.auditEvent.deleteMany({ where: { resourceId: id } });
  await platform.env.ATTACHMENTS.delete(objectKey);
  await platform.dispose();
  await db.$disconnect();
}
