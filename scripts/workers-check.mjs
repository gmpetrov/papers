import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

const credentials = Object.fromEntries(
  (await readFile(".env.e2e", "utf8"))
    .trim()
    .split("\n")
    .map((line) => line.split("=")),
);
const base = "http://localhost:3001";
const origin = "https://dev.chaindesk.ai";
let cookie = "";
async function request(path, method = "GET", body, extraHeaders = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: cookie,
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length)
    cookie = cookies.map((value) => value.split(";")[0]).join("; ");
  assert.ok(response.ok, `${method} ${path}: ${response.status}`);
  return response.json();
}

assert.equal((await request("/api/health")).database, "connected");
process.loadEnvFile(".env");
const eventId = `workers-smoke-${crypto.randomUUID()}`;
const webhook = {
  type: "email.received",
  created_at: new Date().toISOString(),
  data: {
    email_id: eventId,
    received_for: ["unallocated@workers-smoke.invalid"],
  },
};
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = createHmac(
  "sha256",
  Buffer.from(
    process.env.RESEND_WEBHOOK_SECRET.replace(/^whsec_/, ""),
    "base64",
  ),
)
  .update(`${eventId}.${timestamp}.${JSON.stringify(webhook)}`)
  .digest("base64");
assert.equal(
  (
    await request("/api/webhooks/resend", "POST", webhook, {
      "svix-id": eventId,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    })
  ).received,
  true,
);
const google = await request("/api/auth/sign-in/social", "POST", {
  provider: "google",
  callbackURL: `${origin}/dashboard`,
  disableRedirect: true,
});
const googleUrl = new URL(google.url);
assert.equal(googleUrl.hostname, "accounts.google.com");
assert.equal(
  googleUrl.searchParams.get("redirect_uri"),
  `${origin}/api/auth/callback/google`,
);
await request("/api/auth/sign-in/email", "POST", {
  email: credentials.TEST_EMAIL,
  password: credentials.TEST_PASSWORD,
});
assert.equal(
  (await request("/api/auth/get-session")).user.email,
  credentials.TEST_EMAIL,
);
const organizations = await request("/api/auth/organization/list");
assert.ok(
  organizations.length,
  "Run browser-check.mjs first to create the local test workspace",
);
await request("/api/auth/organization/set-active", "POST", {
  organizationId: organizations[0].id,
});
assert.equal((await request("/v1/me")).organizationId, organizations[0].id);
const openapi = await request("/openapi.json");
for (const [path, schema] of [
  ["/capabilities", "Capabilities"],
  ["/workspace/policy", "WorkspacePolicyResponse"],
  ["/workspace/usage", "WorkspaceUsage"],
  ["/events", "EventPage"],
]) {
  assert.equal(
    openapi.paths[path].get.responses["200"].content["application/json"].schema
      .$ref,
    `#/components/schemas/${schema}`,
  );
  assert.ok(openapi.components.schemas[schema]);
}
const capabilities = await request("/v1/capabilities");
assert.equal(capabilities.email.provider, "resend");
assert.equal(capabilities.phone.provider, "telnyx");
assert.equal(typeof capabilities.phone.available, "boolean");
assert.deepEqual(capabilities.cards, { available: false, status: "deferred" });
const policy = await request("/v1/workspace/policy");
for (const flag of [
  "requireEmailApproval",
  "requireSmsApproval",
  "requireProvisioningApproval",
])
  assert.equal(typeof policy.policy[flag], "boolean");
const usage = await request("/v1/workspace/usage");
assert.equal(usage.timezone, "UTC");
assert.equal(usage.costSource, "provider_callbacks");
assert.equal(usage.billingStatus, "not_implemented");
assert.ok(Array.isArray(usage.sms));

const key = await request("/v1/api-keys", "POST", {
  name: "Workers smoke test",
  scopes: ["inboxes:read", "sms:send"],
  expiresInDays: 1,
  dailyEmailLimit: 0,
  dailySmsLimit: 2,
  dailyInboxLimit: 0,
  dailyNumberLimit: 1,
});
try {
  const headers = {
    Authorization: `Bearer ${key.token}`,
    Accept: "application/json, text/event-stream",
  };
  const initialized = await request(
    "/mcp",
    "POST",
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "workers-smoke", version: "1.0.0" },
      },
    },
    headers,
  );
  assert.ok(initialized.result.serverInfo);
  const identity = await request(
    "/mcp",
    "POST",
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "get_identity", arguments: {} },
    },
    headers,
  );
  assert.equal(identity.result.isError, undefined);
  const me = identity.result.structuredContent.data;
  assert.equal(me.organizationId, organizations[0].id);
  assert.equal(me.sendLimits.email.dailyLimit, 0);
  assert.equal(me.sendLimits.email.remaining, 0);
  assert.equal(me.sendLimits.sms.dailyLimit, 2);
  assert.equal(me.provisioningLimits.inboxes.dailyLimit, 0);
  assert.equal(me.provisioningLimits.inboxes.remaining, 0);
  assert.equal(me.provisioningLimits.phoneNumbers.dailyLimit, 1);
  assert.equal(me.provisioningLimits.phoneNumbers.remaining, 0);
  assert.ok(
    me.sendLimits.sms.remaining >= 0 && me.sendLimits.sms.remaining <= 2,
  );
  assert.equal(me.sendLimits.day, new Date().toISOString().slice(0, 10));
  assert.ok(Date.parse(me.sendLimits.resetsAt) > Date.now());
  const result = await request(
    "/mcp",
    "POST",
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "list_inboxes", arguments: {} },
    },
    headers,
  );
  assert.equal(
    result.result.isError,
    undefined,
    result.result.isError ? JSON.stringify(result.result.content) : undefined,
  );
  assert.ok(result.result.content.length);
  const approvals = await request(
    "/mcp",
    "POST",
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_approvals", arguments: { limit: 1 } },
    },
    headers,
  );
  assert.equal(approvals.result.isError, undefined);
  assert.ok(Array.isArray(approvals.result.structuredContent.data.data));
  assert.equal(approvals.result.structuredContent.data.nextCursor, null);
  assert.equal(
    typeof approvals.result.structuredContent.data.policyVersion,
    "number",
  );
  // Exercise the real Worker middleware using only read requests and a temporary
  // key. Extra headroom permits one minute boundary during this bounded check.
  let throttled = false;
  for (let attempt = 0; attempt < 250; attempt++) {
    const response = await fetch(base + "/v1/inboxes?limit=1", { headers });
    if (response.status === 429) {
      const delay = Number(response.headers.get("Retry-After"));
      assert.ok(delay >= 1 && delay <= 60);
      assert.equal((await response.json()).error.code, "rate_limited");
      throttled = true;
      break;
    }
    assert.equal(response.status, 200);
    await response.arrayBuffer();
  }
  assert.ok(throttled, "The Worker must enforce the credential request limit");
} finally {
  await request(`/v1/api-keys/${key.id}`, "DELETE");
}
const ownerInboxes = await request("/v1/inboxes?limit=1");
const selections = [[], ...(ownerInboxes.data.length ? [[ownerInboxes.data[0].id]] : [])];
for (const inboxIds of selections) {
  const grants = { inboxIds, phoneNumberIds: [] };
  const restricted = await request("/v1/api-keys", "POST", {
    name: "Workers resource-grant check",
    scopes: ["inboxes:read", "inboxes:write", "numbers:read", "numbers:provision", "events:read"],
    expiresInDays: 1,
    resourceGrants: grants,
  });
  const headers = { Authorization: `Bearer ${restricted.token}` };
  try {
    const identity = await request("/v1/me", "GET", undefined, headers);
    assert.deepEqual(identity.resourceGrants, grants);
    assert.equal(identity.provisioningLimits.inboxes.remaining, 0);
    assert.equal(identity.provisioningLimits.phoneNumbers.remaining, 0);
    assert.deepEqual((await request("/v1/inboxes", "GET", undefined, headers)).data.map(row => row.id), inboxIds);
    assert.deepEqual((await request("/v1/phone-numbers", "GET", undefined, headers)).data, []);
    const events = await request("/v1/events?limit=1", "GET", undefined, headers);
    assert.ok(Array.isArray(events.data));
    if (!inboxIds.length) assert.deepEqual(events.data, []);
    for (const path of ["/v1/inboxes", "/v1/phone-numbers"]) {
      const response = await fetch(base + path, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{}" });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, "resource_restricted");
    }
    if (!inboxIds.length && ownerInboxes.data.length)
      assert.equal((await fetch(base + "/v1/inboxes/" + ownerInboxes.data[0].id, { headers })).status, 404);
  } finally {
    await request(`/v1/api-keys/${restricted.id}`, "DELETE");
  }
}
await request("/api/auth/sign-out", "POST", {});
console.log(
  JSON.stringify({
    passed: [
      "postgres",
      "signed webhook ingress",
      "Google authorization URL",
      "password sign-in",
      "database session",
      "organization selection",
      "authenticated REST",
      "latest OpenAPI response contracts",
      "capabilities, approval policies and usage on Workers",
      "organization API-key MCP initialize and tool calls",
      "MCP identity and per-key send limits on Workers",
      "paginated approvals through remote MCP",
      "HTTP 429 and Retry-After for credential request limits",
      "resource-grant filtering and provisioning denial",
      "key revocation",
      "sign-out",
    ],
  }),
);
