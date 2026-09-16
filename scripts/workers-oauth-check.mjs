import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

const base = "http://localhost:3001",
  origin = "https://dev.chaindesk.ai";
const fixture = Object.fromEntries(
  (await readFile(".env.e2e", "utf8"))
    .trim()
    .split("\n")
    .map((line) => line.split("=")),
);
let cookie = "";
async function call(path, body, extra = {}) {
  const form = path.endsWith("/token") || path.endsWith("/revoke");
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    redirect: "manual",
    headers: {
      Origin: origin,
      Cookie: path.endsWith("/register") ? "" : cookie,
      "Content-Type": form
        ? "application/x-www-form-urlencoded"
        : "application/json",
      ...extra,
    },
    body: body
      ? form
        ? new URLSearchParams(body)
        : JSON.stringify(body)
      : undefined,
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) cookie = cookies.map((c) => c.split(";")[0]).join("; ");
  return response;
}
async function json(response) {
  assert.ok(response.ok, `Unexpected response status ${response.status}`);
  return response.json();
}
await json(
  await call("/api/auth/sign-in/email", {
    email: fixture.TEST_EMAIL,
    password: fixture.TEST_PASSWORD,
  }),
);
const organizations = await json(await call("/api/auth/organization/list"));
const organizationId = organizations[0].id;
await json(await call("/api/auth/organization/set-active", { organizationId }));
const optionsPath =
  "/api/oauth/resource-options?" +
  new URLSearchParams({
    organizationId,
    kind: "inboxes",
  });
assert.equal((await fetch(base + optionsPath)).status, 401);
const optionsResponse = await call(optionsPath);
assert.equal(optionsResponse.headers.get("cache-control"), "no-store");
const options = await json(optionsResponse);
assert.ok(Array.isArray(options.data));
assert.equal(
  (
    await call(
      "/api/oauth/resource-options?" +
        new URLSearchParams({
          organizationId: "unavailable-workspace",
          kind: "inboxes",
        }),
    )
  ).status,
  403,
);
const resourceGrants = { inboxIds: [], phoneNumberIds: [] };
const client = await json(
  await call("/api/auth/oauth2/register", {
    client_name: "Workers OAuth verification",
    application_type: "native",
    redirect_uris: ["http://127.0.0.1:43199/callback"],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  }),
);
const verifier = randomBytes(32).toString("base64url");
const query = new URLSearchParams({
  client_id: client.client_id,
  response_type: "code",
  redirect_uri: "http://127.0.0.1:43199/callback",
  scope: "inboxes:read offline_access",
  resource: origin + "/mcp",
  code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  code_challenge_method: "S256",
  state: "workers-check",
  prompt: "consent",
});
const authorization = await call("/api/auth/oauth2/authorize?" + query);
assert.ok([200, 302].includes(authorization.status));
const selected = new URL(
  authorization.headers.get("location") ?? (await authorization.json()).url,
  origin,
);
const next = await json(
  await call(
    "/api/auth/oauth2/continue",
    { postLogin: true, oauth_query: selected.search.slice(1) },
    { "x-papers-organization-id": organizationId },
  ),
);
const consent = new URL(next.url, origin);
const accepted = await json(
  await call(
    "/api/auth/oauth2/consent",
    { accept: true, oauth_query: consent.search.slice(1) },
    {
      "x-papers-organization-id": organizationId,
      "x-papers-resource-grants": JSON.stringify(resourceGrants),
    },
  ),
);
const returned = new URL(accepted.url, origin);
assert.equal(returned.searchParams.get("state"), "workers-check");
const token = await json(
  await call("/api/auth/oauth2/token", {
    grant_type: "authorization_code",
    client_id: client.client_id,
    code: returned.searchParams.get("code"),
    code_verifier: verifier,
    redirect_uri: "http://127.0.0.1:43199/callback",
    resource: origin + "/mcp",
  }),
);
const headers = {
  Authorization: `Bearer ${token.access_token}`,
  Accept: "application/json, text/event-stream",
};
const tool = await json(
  await call(
    "/mcp",
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_inboxes", arguments: {} },
    },
    headers,
  ),
);
assert.ok(!tool.result.isError);
assert.deepEqual(tool.result.structuredContent.data.data, []);
const denied = await call(
  "/mcp",
  {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "send_email", arguments: {} },
  },
  headers,
);
assert.equal(denied.status, 403);
assert.match(denied.headers.get("www-authenticate"), /insufficient_scope/);
const connections = await json(await call("/v1/connections"));
const connection = connections.data.find(
  (c) => c.oauthclient.clientId === client.client_id,
);
assert.ok(connection);
assert.deepEqual(connection.resourceGrants, resourceGrants);
const limits = await fetch(
  base + "/v1/connections/" + connection.id + "/limits",
  {
    method: "PATCH",
    headers: {
      Origin: origin,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      dailyEmailLimit: 0,
      dailySmsLimit: 2,
      dailyInboxLimit: 0,
      dailyNumberLimit: 1,
    }),
  },
);
assert.equal(limits.status, 200);
const identity = await json(
  await call(
    "/mcp",
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "get_identity", arguments: {} },
    },
    headers,
  ),
);
assert.ok(!identity.result.isError);
assert.deepEqual(
  identity.result.structuredContent.data.resourceGrants,
  resourceGrants,
);
const allowance = identity.result.structuredContent.data.sendLimits;
assert.equal(allowance.email.dailyLimit, 0);
assert.equal(allowance.sms.dailyLimit, 2);
// This consent has read scopes only; numeric caps cannot grant send permission.
assert.equal(allowance.email.remaining, 0);
assert.equal(allowance.sms.remaining, 0);
const provisioning = identity.result.structuredContent.data.provisioningLimits;
assert.equal(provisioning.inboxes.dailyLimit, 0);
assert.equal(provisioning.inboxes.remaining, 0);
assert.equal(provisioning.phoneNumbers.dailyLimit, 1);
assert.equal(provisioning.phoneNumbers.remaining, 0);
const revoked = await fetch(base + "/v1/connections/" + connection.id, {
  method: "DELETE",
  headers: { Origin: origin, Cookie: cookie },
});
assert.equal(revoked.status, 200);
assert.equal(
  (await call("/mcp", { jsonrpc: "2.0", id: 3, method: "tools/list" }, headers))
    .status,
  401,
);
assert.equal(
  (
    await call("/api/auth/oauth2/token", {
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
      client_id: client.client_id,
      resource: origin + "/mcp",
    })
  ).ok,
  false,
);
await call("/api/auth/sign-out", {});
console.log(
  JSON.stringify({
    passed: [
      "Workers PKCE authorization",
      "opaque token issuance",
      "OAuth MCP tool execution",
      "OAuth resource picker session and workspace isolation",
      "empty resource consent persisted and enforced through MCP",
      "scope challenge",
      "session-managed OAuth limits reflected in MCP identity",
      "connection revocation",
      "refresh rejection after revocation",
    ],
  }),
);
