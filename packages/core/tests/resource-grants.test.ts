import { afterAll, beforeAll, expect, it } from "vitest";
import { createDatabase } from "@agentinfra/db";
import type { Auth } from "@agentinfra/auth";
import { scopes } from "@agentinfra/contracts";
import { createApi } from "../src/index";
import { hash } from "../src/errors";
const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_test",
);
// Session behavior is tested separately; this fixture is an authenticated owner.
const auth = {
  options: {
    baseURL: "http://localhost:3000",
    secret: "grants-test-secret-long-enough-for-auth",
  },
  api: {
    getSession: async () => ({
      user: { id: "owner" },
      session: { activeOrganizationId: "one" },
    }),
  },
} as unknown as Auth;
const api = createApi(db, auth, {
  ATTACHMENTS: {
    get: async () => ({ body: new Uint8Array([1]), size: 1 }),
    put: async () => {},
  } as any,
});
const request = (
  path: string,
  method = "GET",
  body?: unknown,
  token: string | null = "restricted",
) =>
  api.request("http://localhost:3000/v1" + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      origin: "http://localhost:3000",
      "content-type": "application/json",
      "idempotency-key": "grant-check",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
beforeAll(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "organization", "user", "Operation", "ProviderEvent" CASCADE',
  );
  await db.user.create({
    data: {
      id: "owner",
      name: "Owner",
      email: "owner@grants.invalid",
      emailVerified: true,
    },
  });
  for (const id of ["one", "two"]) {
    await db.organization.create({
      data: { id, name: id, slug: id, createdAt: new Date() },
    });
    await db.member.create({
      data: {
        id,
        organizationId: id,
        userId: "owner",
        role: "owner",
        createdAt: new Date(),
      },
    });
  }
  for (const [id, organizationId, suffix] of [
    ["allowed", "one", "01"],
    ["excluded", "one", "02"],
    ["foreign", "two", "03"],
  ]) {
    await db.inbox.create({
      data: { id, organizationId, name: id, address: `${id}@grants.invalid` },
    });
    await db.phoneNumber.create({
      data: {
        id,
        organizationId,
        phoneNumber: `+120255501${suffix}`,
        messagingProfileId: "test",
        status: "active",
      },
    });
    await db.emailMessage.create({
      data: {
        id: `email-${id}`,
        organizationId,
        inboxId: id,
        threadId: id,
        direction: "inbound",
        status: "received",
        from: "sender@grants.invalid",
        to: [`${id}@grants.invalid`],
        subject: id,
      },
    });
    await db.attachment.create({
      data: {
        id: `attachment-${id}`,
        messageId: `email-${id}`,
        providerId: id,
        filename: id,
        contentType: "text/plain",
        size: 1,
        objectKey: id,
      },
    });
    await db.smsMessage.create({
      data: {
        id: `sms-${id}`,
        organizationId,
        phoneNumberId: id,
        direction: "inbound",
        status: "received",
        from: "+12025550199",
        to: `+120255501${suffix}`,
        text: id,
      },
    });
    for (const [type, resourceId] of [
      ["email.received", `email-${id}`],
      ["sms.received", `sms-${id}`],
      ["inbox.created", id],
    ])
      await db.event.create({ data: { organizationId, type, resourceId } });
  }
  for (const [token, resourceGrants] of [
    ["restricted", { inboxIds: ["allowed"], phoneNumberIds: ["allowed"] }],
    ["empty", { inboxIds: [], phoneNumberIds: [] }],
    ["malformed", { inboxIds: "invalid" }],
  ] as const) {
    await db.apiKey.create({
      data: {
        id: token,
        organizationId: "one",
        createdBy: "owner",
        name: token,
        prefix: token,
        hash: await hash(token),
        scopes: [...scopes],
        expiresAt: new Date(Date.now() + 3600000),
        resourceGrants,
      },
    });
  }
});
afterAll(() => db.$disconnect());
it("limits resource lists, nested reads and events without leaking another workspace", async () => {
  for (const path of ["/inboxes", "/phone-numbers"]) {
    const response = await request(path);
    expect(response.status).toBe(200);
    expect(
      (await response.json()).data.map((r: { id: string }) => r.id),
    ).toEqual(["allowed"]);
    expect((await request(path + "?cursor=excluded")).status).toBe(400);
  }
  for (const path of [
    "/inboxes/allowed",
    "/inboxes/allowed/messages",
    "/messages/email-allowed",
    "/phone-numbers/allowed",
    "/phone-numbers/allowed/messages",
    "/sms/sms-allowed",
    "/attachments/attachment-allowed/download",
  ])
    expect((await request(path)).status, path).toBe(200);
  for (const id of ["excluded", "foreign"]) {
    for (const path of [
      `/inboxes/${id}`,
      `/inboxes/${id}/messages`,
      `/messages/email-${id}`,
      `/phone-numbers/${id}`,
      `/phone-numbers/${id}/messages`,
      `/sms/sms-${id}`,
      `/attachments/attachment-${id}/download`,
    ])
      expect((await request(path)).status, path).toBe(404);
    expect(
      (await request(`/attachments/attachment-${id}/download-url`, "POST", {}))
        .status,
    ).toBe(404);
  }
  const events = await (await request("/events")).json();
  expect(events.data).toHaveLength(3);
  expect(
    events.data.every((e: { resourceId: string }) =>
      ["allowed", "email-allowed", "sms-allowed"].includes(e.resourceId),
    ),
  ).toBe(true);
  const first = await (await request("/events?limit=1")).json();
  const next = await (
    await request(`/events?cursor=${first.nextCursor}`)
  ).json();
  expect(next.data).toHaveLength(2);
});
it("denies mutations outside the grant and creation beyond an explicit selection", async () => {
  const requests: [string, string, unknown][] = [
    ["/inboxes/excluded", "PATCH", { status: "archived" }],
    ["/messages/email-excluded", "PATCH", { unread: false }],
    [
      "/inboxes/excluded/messages",
      "POST",
      { to: ["recipient@grants.invalid"], subject: "test", text: "test" },
    ],
    ["/messages/email-excluded/reply", "POST", { text: "test" }],
    [
      "/phone-numbers/excluded/messages",
      "POST",
      { to: "+12025550199", text: "test" },
    ],
    ["/phone-numbers/excluded", "DELETE", {}],
  ];
  for (const [path, method, body] of requests)
    expect((await request(path, method, body)).status, path).toBe(404);
  expect(
    (await request("/inboxes", "POST", { name: "New", localPart: "new-inbox" }))
      .status,
  ).toBe(403);
  expect((await request("/phone-numbers", "POST", {})).status).toBe(403);
  expect((await request("/agents")).status).toBe(403);
  const me = await (await request("/me")).json();
  expect(me.resourceGrants).toEqual({
    inboxIds: ["allowed"],
    phoneNumberIds: ["allowed"],
  });
  expect(me.provisioningLimits.inboxes.remaining).toBe(0);
  expect(me.provisioningLimits.phoneNumbers.remaining).toBe(0);
});
it("treats an empty selection as no resources and malformed stored grants as unauthorized", async () => {
  for (const path of ["/inboxes", "/phone-numbers", "/events"])
    expect(
      (await (await request(path, "GET", undefined, "empty")).json()).data,
    ).toEqual([]);
  expect(
    (await request("/inboxes", "GET", undefined, "malformed")).status,
  ).toBe(401);
});
it("only lets an owner select existing resources in the current workspace", async () => {
  const base = {
    name: "Selected",
    scopes: ["inboxes:read"],
    resourceGrants: { inboxIds: ["foreign"], phoneNumberIds: [] },
  };
  expect((await request("/api-keys", "POST", base, null)).status).toBe(404);
  const response = await request(
    "/api-keys",
    "POST",
    {
      ...base,
      resourceGrants: { inboxIds: ["allowed", "allowed"], phoneNumberIds: [] },
    },
    null,
  );
  expect(response.status).toBe(201);
  const key = await response.json();
  expect(
    (
      await (await request("/inboxes", "GET", undefined, key.token)).json()
    ).data.map((r: { id: string }) => r.id),
  ).toEqual(["allowed"]);
  expect(
    (await db.apiKey.findUniqueOrThrow({ where: { id: key.id } }))
      .resourceGrants,
  ).toEqual({ inboxIds: ["allowed"], phoneNumberIds: [] });
});

it("rechecks resource access when redeeming a signed attachment URL", async () => {
  const response = await request(
    "/attachments/attachment-allowed/download-url",
    "POST",
    {},
  );
  expect(response.status).toBe(200);
  const { url } = await response.json();
  expect((await api.request(url)).status).toBe(200);
  await db.apiKey.update({
    where: { id: "restricted" },
    data: { resourceGrants: { inboxIds: [], phoneNumberIds: [] } },
  });
  try {
    expect((await api.request(url)).status).toBe(404);
  } finally {
    await db.apiKey.update({
      where: { id: "restricted" },
      data: {
        resourceGrants: { inboxIds: ["allowed"], phoneNumberIds: ["allowed"] },
      },
    });
  }
});
