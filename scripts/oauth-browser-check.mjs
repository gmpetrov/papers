import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const origin = "https://dev.chaindesk.ai";
const clientName = "Browser OAuth verification " + Date.now();
const callback = "http://127.0.0.1:43199/callback";
const credentials = Object.fromEntries(
  (await readFile(".env.e2e", "utf8"))
    .trim()
    .split("\n")
    .map((line) => line.split("=")),
);
const registration = await fetch(origin + "/api/auth/oauth2/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    client_name: clientName,
    application_type: "native",
    redirect_uris: [callback],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  }),
});
assert.ok(registration.ok, `Registration status ${registration.status}`);
const client = await registration.json();
const verifier = randomBytes(32).toString("base64url");
const query = new URLSearchParams({
  client_id: client.client_id,
  response_type: "code",
  redirect_uri: callback,
  scope: "inboxes:read offline_access",
  resource: origin + "/mcp",
  code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  code_challenge_method: "S256",
  state: "browser-check",
  prompt: "consent",
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame())
      console.log("Browser step:", new URL(frame.url()).pathname);
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(callback + "**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "Authorization returned to the test client.",
    }),
  );
  await page.goto(origin + "/api/auth/oauth2/authorize?" + query, {
    waitUntil: "networkidle",
  });
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
  const organizationId = await page
    .getByLabel("Workspace", { exact: true })
    .inputValue();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL("**/consent?**");
  await page.getByRole("heading", { name: "Connect " + clientName }).waitFor();
  await page.screenshot({
    path: "test-results/oauth-consent.png",
    fullPage: true,
    timeout: 15000,
  });
  await page.getByRole("button", { name: "Allow access", exact: true }).click();
  await page.waitForURL(callback + "?**");
  const returned = new URL(page.url());
  assert.equal(returned.searchParams.get("state"), "browser-check");
  const response = await fetch(origin + "/api/auth/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.client_id,
      code: returned.searchParams.get("code"),
      code_verifier: verifier,
      redirect_uri: callback,
      resource: origin + "/mcp",
    }),
  });
  assert.ok(response.ok, `Token status ${response.status}`);
  const token = await response.json();
  const tool = await fetch(origin + "/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_inboxes", arguments: {} },
    }),
  });
  assert.ok(tool.ok, `MCP status ${tool.status}`);
  assert.ok(!(await tool.json()).result.isError);
  await page.goto(origin + "/dashboard/integrations", {
    waitUntil: "networkidle",
  });
  await page.locator('[data-dashboard-ready="true"]').waitFor();
  if (
    (await page.getByLabel("Organization", { exact: true }).inputValue()) !==
    organizationId
  ) {
    const [changed] = await Promise.all([
      page.waitForResponse((response) =>
        response.url().endsWith("/api/auth/organization/set-active"),
      ),
      page
        .getByLabel("Organization", { exact: true })
        .selectOption(organizationId),
    ]);
    assert.ok(changed.ok());
  }
  const connection = page.getByRole("row").filter({ hasText: clientName });
  await connection.getByRole("button", { name: "Revoke" }).click();
  await connection.waitFor({ state: "hidden" });
  const revoked = await fetch(origin + "/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  });
  assert.equal(revoked.status, 401);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: [
        "client registration",
        "browser sign-in",
        "organization selection",
        "consent",
        "PKCE exchange",
        "OAuth MCP tool call",
        "dashboard revocation",
      ],
    }),
  );
} finally {
  await browser.close();
}
