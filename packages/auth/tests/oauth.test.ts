import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { createDatabase } from "@agentinfra/db";
import { createAuth } from "@agentinfra/auth";
import { createApi } from "../../core/src/index";

const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_test",
);
const origin = "http://localhost:3000";
const env = {
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: "oauth-test-secret-long-enough-for-local-tests",
};
let auth: ReturnType<typeof createAuth>;
let cookie = "",
  clientId = "";
async function call(
  path: string,
  body?: Record<string, unknown>,
  organizationId?: string,
  resourceGrants?: string,
) {
  const form = ["/oauth2/token", "/oauth2/revoke"].includes(path);
  const headers = new Headers({
    Origin: origin,
    Cookie: path === "/oauth2/register" ? "" : cookie,
    "Content-Type": form
      ? "application/x-www-form-urlencoded"
      : "application/json",
  });
  const authority = createAuth(db, env, { organizationId, resourceGrants });
  const response = await authority.handler(
    new Request(origin + "/api/auth" + path, {
      method: body ? "POST" : "GET",
      headers,
      body: body
        ? form
          ? new URLSearchParams(body as Record<string, string>).toString()
          : JSON.stringify(body)
        : undefined,
    }),
  );
  const cookies = response.headers.getSetCookie();
  if (cookies.length) {
    const jar = new Map<string, string>();
    for (const pair of [
      ...cookie.split("; "),
      ...cookies.map((c) => c.split(";")[0]!),
    ]) {
      const separator = pair.indexOf("=");
      if (separator > 0)
        jar.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    cookie = [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
  }
  return response;
}
async function json(response: Response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  expect(response.ok, JSON.stringify(data)).toBe(true);
  return data;
}
async function beginConsent() {
  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: "http://127.0.0.1:43199/callback",
    scope: "inboxes:read offline_access",
    resource: origin + "/mcp",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: "test-state",
    prompt: "consent",
  });
  const start = await call("/oauth2/authorize?" + query);
  const location = start.headers.get("location");
  expect(location).toBeTruthy();
  const selection = new URL(location!, origin);
  expect(selection.pathname).toBe("/select-organization");
  const next = await json(
    await call(
      "/oauth2/continue",
      { postLogin: true, oauth_query: selection.search.slice(1) },
      "oauth-org",
    ),
  );
  const consent = new URL(next.url, origin);
  expect(consent.pathname).toBe("/consent");
  return { consent, verifier };
}
async function code(resourceGrants?: string) {
  const { consent, verifier } = await beginConsent();
  const accepted = await json(
    await call(
      "/oauth2/consent",
      { accept: true, oauth_query: consent.search.slice(1) },
      "oauth-org",
      resourceGrants,
    ),
  );
  const redirect = new URL(accepted.url);
  expect(redirect.searchParams.get("state")).toBe("test-state");
  expect(redirect.searchParams.get("code")).toBeTruthy();
  return {
    code: redirect.searchParams.get("code")!,
    code_verifier: verifier,
    redirect_uri: "http://127.0.0.1:43199/callback",
    client_id: clientId,
    grant_type: "authorization_code",
    resource: origin + "/mcp",
  };
}
const request = (
  token: string,
  path = "/v1/me",
  resource: "/mcp" | "/v1" = "/mcp",
) =>
  createApi(db, auth, {}, resource).request(origin + path, {
    headers: { Authorization: `Bearer ${token}` },
  });
beforeAll(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "organization", "user", "Operation", "ProviderEvent", "oauthResource" CASCADE',
  );
  await db.user.create({
    data: {
      id: "oauth-user",
      name: "OAuth test",
      email: "oauth@example.test",
      emailVerified: true,
    },
  });
  await db.account.create({
    data: {
      id: "oauth-account",
      userId: "oauth-user",
      providerId: "credential",
      accountId: "oauth-user",
      password: await hashPassword("test-password-only"),
    },
  });
  for (const id of ["oauth-org", "other-org"]) {
    await db.organization.create({
      data: { id, name: id, slug: id, createdAt: new Date() },
    });
    await db.member.create({
      data: {
        id,
        organizationId: id,
        userId: "oauth-user",
        role: "owner",
        createdAt: new Date(),
      },
    });
  }
  await json(
    await call("/sign-in/email", {
      email: "oauth@example.test",
      password: "test-password-only",
    }),
  );
  await json(
    await call("/organization/set-active", { organizationId: "oauth-org" }),
  );
  const registration = await json(
    await call("/oauth2/register", {
      client_name: "OAuth test client",
      application_type: "native",
      redirect_uris: ["http://127.0.0.1:43199/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  );
  clientId = registration.client_id;
  auth = createAuth(db, env);
  await auth.$context;
});
afterAll(() => db.$disconnect());
describe("delegated OAuth access", () => {
  it("binds selected resources to consent before code issuance and preserves them on refresh", async () => {
    const selected = await db.inbox.create({
      data: {
        organizationId: "oauth-org",
        name: "Selected",
        address: "oauth-selected@example.test",
      },
    });
    const excluded = await db.inbox.create({
      data: {
        organizationId: "oauth-org",
        name: "Excluded",
        address: "oauth-excluded@example.test",
      },
    });
    const grants = { inboxIds: [selected.id], phoneNumberIds: [] };
    try {
      const exchange = await code(JSON.stringify(grants));
      expect(
        (await db.oauthConsent.findFirstOrThrow({ where: { clientId } }))
          .resourceGrants,
      ).toEqual(grants);
      const token = await json(await call("/oauth2/token", exchange));
      const firstConsent = await db.oauthConsent.findFirstOrThrow({
        where: { clientId },
      });
      await db.operation.create({
        data: {
          id: "old-consent-operation",
          organizationId: "oauth-org",
          principalId: `oauth:${firstConsent.id}`,
          route: "fixture",
          key: "fixture",
          requestHash: "fixture",
          status: "completed",
        },
      });
      expect(
        (
          await request(
            token.access_token,
            "/v1/operations/old-consent-operation",
          )
        ).status,
      ).toBe(200);
      expect(
        (await (await request(token.access_token)).json()).resourceGrants,
      ).toEqual(grants);
      expect(
        (
          await (await request(token.access_token, "/v1/inboxes")).json()
        ).data.map((row: { id: string }) => row.id),
      ).toEqual([selected.id]);
      expect(
        (await request(token.access_token, `/v1/inboxes/${excluded.id}`))
          .status,
      ).toBe(404);
      const refreshed = await json(
        await call("/oauth2/token", {
          grant_type: "refresh_token",
          refresh_token: token.refresh_token,
          client_id: clientId,
          resource: origin + "/mcp",
        }),
      );
      expect(
        (await (await request(refreshed.access_token)).json()).resourceGrants,
      ).toEqual(grants);
      const unredeemed = await code(JSON.stringify(grants));
      const { consent } = await beginConsent();
      const broaden = await call(
        "/oauth2/consent",
        { accept: true, oauth_query: consent.search.slice(1) },
        "oauth-org",
        "null",
      );
      expect(broaden.status).toBe(409);
      await db.oauthConsent.delete({ where: { id: firstConsent.id } });
      expect((await request(refreshed.access_token)).status).toBe(401);
      const newToken = await json(
        await call("/oauth2/token", await code(JSON.stringify(grants))),
      );
      expect(
        (
          await request(
            newToken.access_token,
            "/v1/operations/old-consent-operation",
          )
        ).status,
      ).toBe(404);
      expect((await call("/oauth2/token", unredeemed)).status).toBe(400);
      expect((await request(refreshed.access_token)).status).toBe(401);
      expect(
        (
          await call("/oauth2/token", {
            grant_type: "refresh_token",
            refresh_token: refreshed.refresh_token,
            client_id: clientId,
            resource: origin + "/mcp",
          })
        ).status,
      ).toBe(400);
      expect(
        (await db.oauthConsent.findFirstOrThrow({ where: { clientId } }))
          .resourceGrants,
      ).toEqual(grants);
    } finally {
      await db.oauthConsent.deleteMany({ where: { clientId } });
      await db.oauthAccessToken.deleteMany({ where: { clientId } });
      await db.oauthRefreshToken.deleteMany({ where: { clientId } });
      await db.inbox.deleteMany({
        where: { id: { in: [selected.id, excluded.id] } },
      });
    }
  });
  it("rejects foreign resource selections without creating consent", async () => {
    const foreign = await db.inbox.create({
      data: {
        organizationId: "other-org",
        name: "Foreign",
        address: "oauth-foreign@example.test",
      },
    });
    try {
      const { consent } = await beginConsent();
      const response = await call(
        "/oauth2/consent",
        { accept: true, oauth_query: consent.search.slice(1) },
        "oauth-org",
        JSON.stringify({ inboxIds: [foreign.id], phoneNumberIds: [] }),
      );
      expect(response.status).toBe(400);
      expect(await db.oauthConsent.count({ where: { clientId } })).toBe(0);
    } finally {
      await db.inbox.delete({ where: { id: foreign.id } });
    }
  });

  it("redeems MCP-issued attachment links through REST and honors OAuth revocation", async () => {
    const token = await json(await call("/oauth2/token", await code()));
    const inbox = await db.inbox.create({
      data: {
        organizationId: "oauth-org",
        name: "Link fixture",
        address: "oauth-links@example.test",
      },
    });
    const message = await db.emailMessage.create({
      data: {
        organizationId: "oauth-org",
        inboxId: inbox.id,
        threadId: "link",
        direction: "inbound",
        status: "received",
        from: "fixture@example.test",
        to: [inbox.address],
        subject: "Attachment",
        attachments: {
          create: {
            id: "oauth-attachment",
            providerId: "fixture",
            filename: "file.txt",
            contentType: "text/plain",
            size: 4,
            objectKey: "private",
          },
        },
      },
    });
    const storage = {
      ATTACHMENTS: {
        put: async () => {},
        get: async () => ({ body: new Response("test").body!, size: 4 }),
      },
    };
    try {
      const mcp = createApi(db, auth, storage, "/mcp");
      const rest = createApi(db, auth, storage);
      const minted = await mcp.request(
        origin + "/v1/attachments/oauth-attachment/download-url",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token.access_token}` },
        },
      );
      expect(minted.status).toBe(200);
      const link = await minted.json();
      expect((await rest.request(link.url)).status).toBe(200);
      await json(
        await call("/oauth2/revoke", {
          token: token.access_token,
          client_id: clientId,
        }),
      );
      expect((await rest.request(link.url)).status).toBe(401);
    } finally {
      await db.emailMessage.delete({ where: { id: message.id } });
      await db.inbox.delete({ where: { id: inbox.id } });
    }
  });
  it("completes PKCE and binds the token to the explicit organization and audience", async () => {
    const token = await json(await call("/oauth2/token", await code()));
    expect(token.access_token).toBeTruthy();
    expect(token.refresh_token).toBeTruthy();
    await json(
      await call("/organization/set-active", { organizationId: "other-org" }),
    );
    const result = await request(token.access_token);
    expect(result.status).toBe(200);
    expect((await result.json()).organizationId).toBe("oauth-org");
    expect((await request(token.access_token, "/v1/me", "/v1")).status).toBe(
      401,
    );
    expect((await request(token.access_token, "/v1/agents")).status).toBe(403);
    const otherOperation = await db.operation.create({
      data: {
        organizationId: "oauth-org",
        principalId: "another-client",
        route: "email.send:test",
        key: "other-operation",
        requestHash: "test",
      },
    });
    expect(
      (await request(token.access_token, "/v1/operations/" + otherOperation.id))
        .status,
    ).toBe(404);
    expect((await db.oauthAccessToken.findFirstOrThrow()).token).not.toBe(
      token.access_token,
    );
  });
  it("rejects an incorrect PKCE verifier", async () => {
    const parameters = await code();
    parameters.code_verifier = "x".repeat(43);
    const rejected = await call("/oauth2/token", parameters);
    expect(rejected.status).toBe(401);
    expect((await rejected.json()).error).toBe("invalid_request");
  });
  it("rejects replayed authorization codes", async () => {
    const parameters = await code();
    await json(await call("/oauth2/token", parameters));
    expect((await call("/oauth2/token", parameters)).status).toBe(400);
  });
  it("honors access token revocation immediately", async () => {
    const token = await json(await call("/oauth2/token", await code()));
    await json(
      await call("/oauth2/revoke", {
        token: token.access_token,
        client_id: clientId,
        token_type_hint: "access_token",
      }),
    );
    expect((await request(token.access_token)).status).toBe(401);
  });
  it("refreshes tokens without expanding the audience or scopes", async () => {
    const token = await json(await call("/oauth2/token", await code()));
    const refreshed = await json(
      await call("/oauth2/token", {
        grant_type: "refresh_token",
        refresh_token: token.refresh_token,
        client_id: clientId,
        resource: origin + "/mcp",
      }),
    );
    expect((await request(refreshed.access_token)).status).toBe(200);
    expect(
      (await request(refreshed.access_token, "/v1/me", "/v1")).status,
    ).toBe(401);
  });
  it("rejects refresh requests that add unapproved scopes", async () => {
    const token = await json(await call("/oauth2/token", await code()));
    const expanded = await call("/oauth2/token", {
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
      client_id: clientId,
      resource: origin + "/mcp",
      scope: "email:send",
    });
    expect(expanded.ok).toBe(false);
  });
  it("revokes an entire connection from a human session", async () => {
    const token = await json(await call("/oauth2/token", await code()));
    await json(
      await call("/organization/set-active", { organizationId: "oauth-org" }),
    );
    const api = createApi(db, auth, {});
    const headers = { Cookie: cookie, Origin: origin };
    const connections = await (
      await api.request(origin + "/v1/connections", { headers })
    ).json();
    expect(connections.data.length).toBeGreaterThan(0);
    const limitsPath =
      origin + "/v1/connections/" + connections.data[0].id + "/limits";
    const limitsBody = { dailyEmailLimit: 2, dailySmsLimit: 0 };
    expect(
      (
        await api.request(limitsPath, {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(limitsBody),
        })
      ).status,
    ).toBe(200);
    expect(
      await db.oauthConsent.findUniqueOrThrow({
        where: { id: connections.data[0].id },
      }),
    ).toMatchObject(limitsBody);
    expect(
      (
        await createApi(db, auth, {}, "/mcp").request(limitsPath, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(limitsBody),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api.request(limitsPath, {
          method: "PATCH",
          headers: {
            ...headers,
            Origin: "https://untrusted.example",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(limitsBody),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api.request(limitsPath, {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ ...limitsBody, dailySmsLimit: -1 }),
        })
      ).status,
    ).toBe(400);
    const self = await (await request(token.access_token)).json();
    expect(self.sendLimits.email.dailyLimit).toBe(2);
    expect(self.sendLimits.sms.remaining).toBe(0);

    const revoked = await api.request(
      origin + "/v1/connections/" + connections.data[0].id,
      { method: "DELETE", headers },
    );
    expect(revoked.status).toBe(200);
    expect((await request(token.access_token)).status).toBe(401);
    expect(
      (
        await call("/oauth2/token", {
          grant_type: "refresh_token",
          refresh_token: token.refresh_token,
          client_id: clientId,
          resource: origin + "/mcp",
        })
      ).ok,
    ).toBe(false);
  });
  it("does not let ordinary users configure trusted clients", async () => {
    const response = await call("/oauth2/create-client", {
      client_name: "Consent bypass attempt",
      redirect_uris: ["https://example.test/callback"],
      skip_consent: true,
    });
    expect(response.status).toBe(401);
  });
  it("denied consent returns no authorization code", async () => {
    const { consent } = await beginConsent();
    const denied = await json(
      await call(
        "/oauth2/consent",
        { accept: false, oauth_query: consent.search.slice(1) },
        "oauth-org",
      ),
    );
    const redirect = new URL(denied.url);
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.has("code")).toBe(false);
  });
  it("rejects tampering with the signed consent request", async () => {
    const { consent } = await beginConsent();
    consent.searchParams.set("scope", "email:send");
    const rejected = await call(
      "/oauth2/consent",
      { accept: true, oauth_query: consent.search.slice(1) },
      "oauth-org",
    );
    expect(rejected.ok).toBe(false);
  });
  it("blocks consent while impersonating", async () => {
    const { consent } = await beginConsent();
    const originalCookie = cookie;
    await db.user.create({
      data: {
        id: "support-admin",
        name: "Support",
        email: "support@example.test",
        emailVerified: true,
        role: "admin",
      },
    });
    await db.account.create({
      data: {
        id: "support-account",
        userId: "support-admin",
        accountId: "support-admin",
        providerId: "credential",
        password: await hashPassword("support-test-password"),
      },
    });
    await json(
      await call("/sign-in/email", {
        email: "support@example.test",
        password: "support-test-password",
      }),
    );
    const impersonation = await json(
      await call("/admin/impersonate-user", {
        userId: "oauth-user",
      }),
    );
    expect(impersonation.session.impersonatedBy).toBe("support-admin");
    try {
      expect(
        (
          await call(
            "/oauth2/consent",
            { accept: true, oauth_query: consent.search.slice(1) },
            "oauth-org",
          )
        ).status,
      ).toBe(403);
    } finally {
      cookie = originalCookie;
      await db.session.delete({ where: { id: impersonation.session.id } });
    }
  });
  it("honors organization membership removal immediately", async () => {
    const token = await json(await call("/oauth2/token", await code()));
    await db.user.create({
      data: {
        id: "oauth-successor",
        name: "Successor",
        email: "oauth-successor@example.test",
      },
    });
    await db.member.create({
      data: {
        id: "oauth-successor",
        organizationId: "oauth-org",
        userId: "oauth-successor",
        role: "owner",
        createdAt: new Date(),
      },
    });
    await db.member.delete({ where: { id: "oauth-org" } });
    expect((await request(token.access_token)).status).toBe(403);
  });
});
