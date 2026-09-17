import {
  capabilitiesSchema,
  eventPageSchema,
  identitySchema,
  emailDetailSchema,
  emailPageSchema,
  errorResponseSchema,
  inboxPageSchema,
  phoneNumberPageSchema,
  phoneNumberSchema,
} from "../../contracts/src/responses";
import { confirmEmailSend } from "../src/email-delivery";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { createDatabase } from "../../db/src/index";
import { createAuth } from "../../auth/src/index";
import { createApi } from "../src/index";
import { ingestResend, processProviderEvents } from "../src/webhooks";
import { hash } from "../src/errors";
import { createHmac } from "node:crypto";
const mock = vi.hoisted(() => ({ send: vi.fn(), get: vi.fn() }));
vi.mock("@agentinfra/providers", async (original) => ({
  ...(await original<object>()),
  sendAccountEmail: vi.fn(),
  resendClient: () => ({
    emails: { send: mock.send, receiving: { get: mock.get } },
  }),
}));
const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_test",
);
const auth = createAuth(db, {
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-for-better-auth",
});
const secret = "whsec_" + Buffer.from("a".repeat(32)).toString("base64");
const env = {
  EMAIL_DOMAIN: "example.test",
  RESEND_API_KEY: "test",
  RESEND_WEBHOOK_SECRET: secret,
};
const api = createApi(db, auth, env);
let agentId = "",
  otherAgent = "",
  inboxId = "",
  keyId = "";
const req = (
  path: string,
  method = "GET",
  body?: unknown,
  key = "one",
  token = "test-key",
) =>
  api.request("http://localhost:3000" + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
beforeAll(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "organization", "user", "Operation", "ProviderEvent" CASCADE',
  );
  for (const id of ["one", "two"]) {
    await db.user.create({
      data: { id, name: id, email: `${id}@example.test`, emailVerified: true },
    });
    await db.organization.create({
      data: { id, name: id, slug: id, createdAt: new Date() },
    });
    await db.member.create({
      data: {
        id,
        organizationId: id,
        userId: id,
        role: "owner",
        createdAt: new Date(),
      },
    });
    const project = await db.project.create({ data: { organizationId: id } });
    const a = await db.agent.create({
      data: {
        organizationId: id,
        projectId: project.id,
        name: "Test",
        dailySendLimit: 1,
      },
    });
    if (id === "one") agentId = a.id;
    else otherAgent = a.id;
    const k = await db.apiKey.create({
      data: {
        organizationId: id,
        createdBy: id,
        agentId: a.id,
        name: "Test",
        prefix: id,
        hash: await hash(id === "one" ? "test-key" : "other-key"),
        scopes: [
          "agents:read",
          "inboxes:read",
          "inboxes:write",
          "email:send",
          "events:read",
          "numbers:read",
        ],
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    if (id === "one") keyId = k.id;
  }
  mock.send.mockResolvedValue({ data: { id: "resend-out" }, error: null });
});
afterAll(async () => {
  await db.$disconnect();
});
describe("tenant and agent API", () => {
  it("returns documented validation paths without raw input or internal validator metadata", async () => {
    const response = await req("/v1/inboxes?limit=101");
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(errorResponseSchema.safeParse(body).success).toBe(true);
    expect(body.error.details).toEqual([
      { code: "too_big", path: ["limit"], message: expect.any(String) },
    ]);
    expect(body.error.retryable).toBe(false);
  });
  it("paginates every inbox and number with tied timestamps and rejects foreign cursors", async () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const ids = Array.from(
      { length: 103 },
      (_, n) => `resource-page-${String(n).padStart(3, "0")}`,
    );
    await db.inbox.createMany({
      data: ids.map((id) => ({
        id,
        organizationId: "one",
        agentId,
        name: id,
        address: `${id}@example.test`,
        createdAt,
      })),
    });
    await db.phoneNumber.createMany({
      data: ids.map((id, n) => ({
        id,
        organizationId: "one",
        agentId,
        phoneNumber: `+1202555${String(n).padStart(4, "0")}`,
        messagingProfileId: "pagination-fixture",
        createdAt,
      })),
    });
    const foreign = "resource-page-foreign";
    await db.inbox.create({
      data: {
        id: foreign,
        organizationId: "two",
        agentId: otherAgent,
        name: foreign,
        address: `${foreign}@example.test`,
      },
    });
    await db.phoneNumber.create({
      data: {
        id: foreign,
        organizationId: "two",
        agentId: otherAgent,
        phoneNumber: "+12025559999",
        messagingProfileId: "pagination-fixture",
      },
    });
    try {
      for (const path of ["/v1/inboxes", "/v1/phone-numbers"]) {
        const schema =
          path === "/v1/inboxes" ? inboxPageSchema : phoneNumberPageSchema;
        const first = await (await req(path)).json();
        expect(schema.safeParse(first).success).toBe(true);
        expect(first.data).toHaveLength(100);
        expect(first.nextCursor).toBe(ids[3]);
        const last = await (
          await req(`${path}?cursor=${first.nextCursor}`)
        ).json();
        expect(schema.safeParse(last).success).toBe(true);
        expect(last.data.map((item: { id: string }) => item.id)).toEqual(
          ids.slice(0, 3).reverse(),
        );
        expect(last.nextCursor).toBeNull();
        const seen: string[] = [];
        let cursor: string | null = null;
        do {
          const page = await (
            await req(`${path}?limit=17${cursor ? `&cursor=${cursor}` : ""}`)
          ).json();
          seen.push(...page.data.map((item: { id: string }) => item.id));
          cursor = page.nextCursor;
        } while (cursor);
        expect(seen).toEqual([...ids].reverse());
        expect((await req(`${path}?cursor=${foreign}`)).status).toBe(400);
        expect((await req(`${path}?cursor=missing`)).status).toBe(400);
        expect((await req(`${path}?limit=101`)).status).toBe(400);
      }
      const number = await (await req(`/v1/phone-numbers/${ids[0]}`)).json();
      expect(phoneNumberSchema.safeParse(number).success).toBe(true);
      expect(number).not.toHaveProperty("messagingProfileId");
      expect(number).not.toHaveProperty("providerId");
    } finally {
      await db.inbox.deleteMany({ where: { id: { in: [...ids, foreign] } } });
      await db.phoneNumber.deleteMany({
        where: { id: { in: [...ids, foreign] } },
      });
    }
  });

  it("only advertises phone provisioning when all required configuration is present", async () => {
    const configured = {
      ...env,
      TELNYX_STATUS: "active",
      TELNYX_API_KEY: "fixture",
      TELNYX_MESSAGING_PROFILE_ID: "profile",
      TELNYX_PUBLIC_KEY: "verification-key",
    };
    for (const field of [
      "TELNYX_API_KEY",
      "TELNYX_MESSAGING_PROFILE_ID",
      "TELNYX_PUBLIC_KEY",
    ] as const) {
      const candidate = createApi(db, auth, {
        ...configured,
        [field]: undefined,
      });
      const response = await candidate.request(
        "http://localhost:3000/v1/capabilities",
        { headers: { Authorization: "Bearer test-key" } },
      );
      const result = capabilitiesSchema.parse(await response.json());
      expect(result.phone).toEqual({
        provider: "telnyx",
        available: false,
        status: "active",
      });
    }
    for (const status of ["active", "under_review"]) {
      const candidate = createApi(db, auth, {
        ...configured,
        TELNYX_STATUS: status,
      });
      const response = await candidate.request(
        "http://localhost:3000/v1/capabilities",
        { headers: { Authorization: "Bearer test-key" } },
      );
      const result = capabilitiesSchema.parse(await response.json());
      expect(result.phone.available).toBe(status === "active");
      expect(result.email).toEqual({
        provider: "resend",
        available: true,
        domain: "example.test",
      });
      expect(result.cards).toEqual({ available: false, status: "deferred" });
    }
  });

  it("returns typed identity and preserves an event polling checkpoint on the final page", async () => {
    const identity = identitySchema.parse(await (await req("/v1/me")).json());
    expect(identity).toMatchObject({
      organizationId: "one",
      userId: "one",
      agentId,
    });
    const event = await db.event.create({
      data: {
        organizationId: "one",
        agentId,
        type: "fixture.created",
        resourceId: "fixture",
      },
    });
    await db.event.create({
      data: {
        organizationId: "two",
        agentId: otherAgent,
        type: "fixture.created",
        resourceId: "private",
      },
    });
    const page = eventPageSchema.parse(await (await req("/v1/events")).json());
    expect(page.data.map((item) => item.id)).toEqual([event.id]);
    expect(page.nextCursor).toBe(event.id);
    const empty = eventPageSchema.parse(
      await (await req(`/v1/events?cursor=${event.id}`)).json(),
    );
    expect(empty).toEqual({ data: [], nextCursor: null });
  });

  it("rejects missing authentication", async () => {
    expect((await api.request("http://localhost:3000/v1/inboxes")).status).toBe(
      401,
    );
  });
  it("does not provision inboxes for another tenant", async () => {
    expect(
      (
        await req("/v1/inboxes", "POST", {
          name: "Bad",
          localPart: "bad-agent",
          agentId: otherAgent,
        })
      ).status,
    ).toBe(404);
  });
  it("requires idempotency keys", async () => {
    const r = await api.request("http://localhost:3000/v1/inboxes", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Test", localPart: "test", agentId }),
    });
    expect(r.status).toBe(400);
  });
  it("creates exactly one inbox for concurrent retries", async () => {
    const payload = { name: "Research", localPart: "research", agentId };
    const responses = await Promise.all([
      req("/v1/inboxes", "POST", payload),
      req("/v1/inboxes", "POST", payload),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    const [a, b] = await Promise.all(responses.map((r) => r.json()));
    expect(a.id).toBe(b.id);
    inboxId = a.id;
    expect(await db.inbox.count({ where: { agentId } })).toBe(1);
  });
  it("rejects changed parameters for the same key", async () => {
    expect(
      (
        await req("/v1/inboxes", "POST", {
          name: "Changed",
          localPart: "research",
          agentId,
        })
      ).status,
    ).toBe(409);
  });
  it("enforces shared capacity during reactivation and records transitions once", async () => {
    const originalOrg = await db.organization.findUniqueOrThrow({
      where: { id: "one" },
    });
    const originalAgent = await db.agent.findUniqueOrThrow({
      where: { id: agentId },
    });
    const archived = await db.inbox.create({
      data: {
        organizationId: "one",
        agentId,
        name: "Archived",
        address: "archived@example.test",
        status: "archived",
      },
    });
    const change = (id: string, status: string) =>
      req(`/v1/inboxes/${id}`, "PATCH", { status });
    try {
      await db.organization.update({
        where: { id: "one" },
        data: { maxInboxes: 1 },
      });
      expect((await change(archived.id, "active")).status).toBe(409);
      expect(
        (
          await req(
            `/v1/inboxes/${archived.id}`,
            "PATCH",
            { status: "active" },
            "unused",
            "other-key",
          )
        ).status,
      ).toBe(404);
      // Repeating an already-active state does not consume capacity or emit an event.
      expect((await change(inboxId, "active")).status).toBe(200);
      expect(
        await db.event.count({ where: { type: "inbox.reactivated" } }),
      ).toBe(0);
      expect((await change(inboxId, "archived")).status).toBe(200);
      expect((await change(inboxId, "archived")).status).toBe(200);
      expect(
        await db.event.count({
          where: { resourceId: inboxId, type: "inbox.archived" },
        }),
      ).toBe(1);
      const responses = await Promise.all([
        change(inboxId, "active"),
        change(archived.id, "active"),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        await db.inbox.count({
          where: { organizationId: "one", status: "active" },
        }),
      ).toBe(1);
      expect(
        await db.auditEvent.count({
          where: { organizationId: "one", action: "inbox.reactivated" },
        }),
      ).toBe(1);
      await change(inboxId, "archived");
      await change(archived.id, "archived");
      await db.organization.update({
        where: { id: "one" },
        data: { maxInboxes: 10 },
      });
      await db.agent.update({
        where: { id: agentId },
        data: { maxInboxes: 0 },
      });
      expect((await change(archived.id, "active")).status).toBe(409);
    } finally {
      await db.inbox.delete({ where: { id: archived.id } });
      await db.organization.update({
        where: { id: "one" },
        data: { maxInboxes: originalOrg.maxInboxes },
      });
      await db.agent.update({
        where: { id: agentId },
        data: { maxInboxes: originalAgent.maxInboxes },
      });
      await db.inbox.update({
        where: { id: inboxId },
        data: { status: "active" },
      });
    }
  });
  it("hides another tenant inbox messages", async () => {
    expect(
      (
        await req(
          `/v1/inboxes/${inboxId}/messages`,
          "GET",
          undefined,
          "one",
          "other-key",
        )
      ).status,
    ).toBe(404);
  });
  it("enforces concurrent send quotas and does not duplicate retries", async () => {
    const payload = {
      to: ["hello@example.test"],
      subject: "Test",
      text: "Test",
    };
    const r = await Promise.all([
      req(`/v1/inboxes/${inboxId}/messages`, "POST", payload, "send-one"),
      req(`/v1/inboxes/${inboxId}/messages`, "POST", payload, "send-two"),
    ]);
    expect(r.map((x) => x.status).sort()).toEqual([201, 429]);
    expect(mock.send).toHaveBeenCalledTimes(1);
    const successKey = r[0]!.status === 201 ? "send-one" : "send-two";
    await req(`/v1/inboxes/${inboxId}/messages`, "POST", payload, successKey);
    expect(mock.send).toHaveBeenCalledTimes(1);
  });
  it("does not let an agent elevate its policy", async () => {
    expect(
      (
        await req(`/v1/agents/${agentId}/policy`, "PATCH", {
          dailySendLimit: 100,
          maxInboxes: 20,
          allowedRecipients: [],
        })
      ).status,
    ).toBe(403);
  });
  it("receives signed mail once using envelope recipients", async () => {
    const event = {
      type: "email.received",
      created_at: new Date().toISOString(),
      data: {
        email_id: "incoming-1",
        to: ["victim@example.test"],
        received_for: ["research@example.test"],
      },
    };
    const body = JSON.stringify(event);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const id = "evt_test";
    const sig = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
      .update(`${id}.${timestamp}.${body}`)
      .digest("base64");
    const request = () =>
      new Request("http://localhost/api/webhooks/resend", {
        method: "POST",
        headers: {
          "svix-id": id,
          "svix-timestamp": timestamp,
          "svix-signature": `v1,${sig}`,
        },
        body,
      });
    mock.get.mockResolvedValue({
      data: {
        id: "incoming-1",
        from: "sender@example.test",
        to: ["victim@example.test"],
        received_for: ["research@example.test"],
        subject: "Inbound",
        text: "Hello",
        html: null,
        message_id: "<inbound>",
        headers: {},
        attachments: [],
        created_at: new Date().toISOString(),
      },
      error: null,
    });
    await ingestResend(db, env, request());
    await ingestResend(db, env, request());
    // This test checks ingestion and routing, not the queue's wall-clock schedule.
    await db.providerEvent.update({
      where: { id },
      data: { availableAt: new Date(0) },
    });
    await processProviderEvents(db, env);
    expect(
      await db.emailMessage.count({ where: { providerId: "incoming-1" } }),
    ).toBe(1);
    expect(await db.providerEvent.count({ where: { id } })).toBe(1);
    const m = await db.emailMessage.findFirstOrThrow({
      where: { providerId: "incoming-1" },
    });
    expect(m.organizationId).toBe("one");
    expect(m.to).toEqual(["research@example.test"]);
    const detail = await (await req(`/v1/messages/${m.id}`)).json();
    expect(emailDetailSchema.safeParse(detail).success).toBe(true);
    expect(detail.providerId).toBeUndefined();
    expect(detail.html).toBeUndefined();
    expect(JSON.stringify(detail)).not.toContain("incoming-1");
    const page = await (await req(`/v1/inboxes/${m.inboxId}/messages`)).json();
    expect(emailPageSchema.safeParse(page).success).toBe(true);
    expect(
      page.data.every(
        (row: Record<string, unknown>) =>
          !("text" in row) && !("providerId" in row),
      ),
    ).toBe(true);
  });
  it("restricts message updates and replies to the owning tenant", async () => {
    const m = await db.emailMessage.findFirstOrThrow({
      where: { providerId: "incoming-1" },
    });
    expect(
      (
        await req(
          `/v1/messages/${m.id}`,
          "PATCH",
          { unread: false },
          "one",
          "other-key",
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await req(
          `/v1/messages/${m.id}/reply`,
          "POST",
          { text: "No access" },
          "reply",
          "other-key",
        )
      ).status,
    ).toBe(404);
    expect(
      (await req(`/v1/messages/${m.id}`, "PATCH", { unread: false })).status,
    ).toBe(200);
    expect(
      (await db.emailMessage.findUniqueOrThrow({ where: { id: m.id } })).unread,
    ).toBe(false);
  });
  it("replies with thread headers and preserves idempotency", async () => {
    await db.agent.update({
      where: { id: agentId },
      data: { dailySendLimit: 10 },
    });
    const m = await db.emailMessage.findFirstOrThrow({
      where: { providerId: "incoming-1" },
    });
    await db.emailMessage.update({
      where: { id: m.id },
      data: {
        replyTo: ["reply@example.test"],
        references: ["<root@example.test>"],
      },
    });
    mock.send.mockResolvedValueOnce({ data: { id: "reply-out" }, error: null });
    const count = mock.send.mock.calls.length;
    const first = await req(
      `/v1/messages/${m.id}/reply`,
      "POST",
      { text: "Thank you" },
      "reply-once",
    );
    expect(first.status).toBe(201);
    expect(mock.send.mock.calls.at(-1)?.[0]).toMatchObject({
      to: ["reply@example.test"],
      subject: "Re: Inbound",
      headers: {
        "In-Reply-To": "<inbound>",
        References: "<root@example.test> <inbound>",
      },
    });
    const output = await first.json();
    expect(
      (
        await db.emailMessage.findUniqueOrThrow({
          where: { id: output.messageId },
        })
      ).threadId,
    ).toBe(m.threadId);
    const conversation = await req(
      `/v1/inboxes/${m.inboxId}/messages?threadId=${encodeURIComponent(m.threadId)}`,
    );
    expect(conversation.status).toBe(200);
    const page = await conversation.json();
    expect(page.data.map((row: { id: string }) => row.id)).toEqual([
      output.messageId,
      m.id,
    ]);
    const missingThread = await req(
      `/v1/inboxes/${m.inboxId}/messages?threadId=unknown-thread`,
    );
    expect((await missingThread.json()).data).toEqual([]);

    expect(
      (
        await req(
          `/v1/messages/${m.id}/reply`,
          "POST",
          { text: "Thank you" },
          "reply-once",
        )
      ).status,
    ).toBe(200);
    expect(mock.send.mock.calls.length).toBe(count + 1);
    expect(
      (
        await req(
          `/v1/messages/${m.id}/reply`,
          "POST",
          { text: "Changed" },
          "reply-once",
        )
      ).status,
    ).toBe(409);
  });
  it("applies recipient policy to Reply-To recipients", async () => {
    await db.agent.update({
      where: { id: agentId },
      data: { allowedRecipients: ["sender@example.test"] },
    });
    const m = await db.emailMessage.findFirstOrThrow({
      where: { providerId: "incoming-1" },
    });
    const count = mock.send.mock.calls.length;
    expect(
      (
        await req(
          `/v1/messages/${m.id}/reply`,
          "POST",
          { text: "Blocked" },
          "reply-blocked",
        )
      ).status,
    ).toBe(403);
    expect(mock.send.mock.calls.length).toBe(count);
  });
  it("rejects unsigned webhooks without persistence", async () => {
    await expect(
      ingestResend(
        db,
        env,
        new Request("http://localhost", { method: "POST", body: "{}" }),
      ),
    ).rejects.toThrow("Invalid webhook");
  });
  it("recovers timed-out sends from tagged webhooks without sending twice", async () => {
    await db.agent.update({
      where: { id: agentId },
      data: { dailySendLimit: 100, allowedRecipients: [] },
    });
    mock.send.mockRejectedValueOnce(new Error("timeout"));
    const response = await req(
      `/v1/inboxes/${inboxId}/messages`,
      "POST",
      { to: ["recipient@example.test"], subject: "Recovery", text: "Hello" },
      "timeout-recovery",
    );
    expect(response.status).toBe(202);
    const operation = await response.json();
    expect(operation.status).toBe("unknown");
    expect(mock.send.mock.calls.at(-1)?.[0].tags).toEqual([
      { name: "papers_operation", value: operation.id },
    ]);
    const message = await db.emailMessage.findUniqueOrThrow({
      where: { id: operation.messageId },
    });
    const payload = {
      type: "email.delivered",
      created_at: new Date().toISOString(),
      data: {
        email_id: "recovered-provider-id",
        from: message.from,
        message_id: "<recovered@example.test>",
        tags: { papers_operation: operation.id },
      },
    };
    await db.providerEvent.create({
      data: {
        id: "recovery-delivered",
        availableAt: new Date(0),
        provider: "resend",
        type: payload.type,
        payload,
      },
    });
    await processProviderEvents(db, env);
    expect(
      (await db.operation.findUniqueOrThrow({ where: { id: operation.id } }))
        .status,
    ).toBe("completed");
    expect(
      await db.emailMessage.findUniqueOrThrow({ where: { id: message.id } }),
    ).toMatchObject({
      providerId: "recovered-provider-id",
      status: "delivered",
      messageId: "<recovered@example.test>",
    });
    await db.providerEvent.create({
      data: {
        id: "recovery-sent-late",
        availableAt: new Date(0),
        provider: "resend",
        type: "email.sent",
        payload: { ...payload, type: "email.sent" },
      },
    });
    await processProviderEvents(db, env);
    expect(
      (await db.emailMessage.findUniqueOrThrow({ where: { id: message.id } }))
        .status,
    ).toBe("delivered");
    expect(
      await db.event.count({
        where: { resourceId: message.id, type: "email.sent" },
      }),
    ).toBe(1);
    const sends = mock.send.mock.calls.length;
    expect(
      (
        await req(
          `/v1/inboxes/${inboxId}/messages`,
          "POST",
          {
            to: ["recipient@example.test"],
            subject: "Recovery",
            text: "Hello",
          },
          "timeout-recovery",
        )
      ).status,
    ).toBe(200);
    expect(mock.send.mock.calls.length).toBe(sends);
  });
  it("does not downgrade a webhook confirmation when the send request times out", async () => {
    mock.send.mockImplementationOnce(async (input, options) => {
      await db.providerEvent.create({
        data: {
          id: "early-sent",
          availableAt: new Date(0),
          provider: "resend",
          type: "email.sent",
          payload: {
            type: "email.sent",
            created_at: new Date().toISOString(),
            data: {
              email_id: "early-provider-id",
              from: input.from,
              tags: { papers_operation: options.idempotencyKey },
            },
          },
        },
      });
      await processProviderEvents(db, env);
      throw new Error("response lost");
    });
    const response = await req(
      `/v1/inboxes/${inboxId}/messages`,
      "POST",
      { to: ["recipient@example.test"], subject: "Race", text: "Hello" },
      "early-webhook",
    );
    expect(response.status).toBe(200);
    const operation = await response.json();
    expect(operation.status).toBe("completed");
    expect(
      (await db.operation.findUniqueOrThrow({ where: { id: operation.id } }))
        .error,
    ).toBeNull();
    expect(
      await db.event.count({
        where: { resourceId: operation.messageId, type: "email.sent" },
      }),
    ).toBe(1);
  });
  it("keeps suppressed and complained states when delivery events arrive late", async () => {
    const message = await db.emailMessage.findFirstOrThrow({
      where: { providerId: "recovered-provider-id" },
    });
    async function enqueue(id: string, type: string) {
      await db.providerEvent.create({
        data: {
          id,
          // This fixture is already due; avoid PostgreSQL timestamp rounding at now().
          availableAt: new Date(0),
          provider: "resend",
          type,
          payload: {
            type,
            created_at: new Date().toISOString(),
            data: { email_id: message.providerId },
          },
        },
      });
    }
    await enqueue("suppressed-first", "email.suppressed");
    await processProviderEvents(db, env);
    expect(
      (await db.emailMessage.findUniqueOrThrow({ where: { id: message.id } }))
        .status,
    ).toBe("suppressed");
    await enqueue("late-delivery", "email.delivered");
    await enqueue("complaint", "email.complained");
    await Promise.all([
      processProviderEvents(db, env, 1),
      processProviderEvents(db, env, 1),
    ]);
    expect(
      (await db.emailMessage.findUniqueOrThrow({ where: { id: message.id } }))
        .status,
    ).toBe("complained");
    await enqueue("duplicate-complaint", "email.complained");
    await enqueue("later-delivery", "email.delivered");
    await processProviderEvents(db, env);
    expect(
      await db.event.count({
        where: { resourceId: message.id, type: "email.complained" },
      }),
    ).toBe(1);
    expect(
      (await db.emailMessage.findUniqueOrThrow({ where: { id: message.id } }))
        .status,
    ).toBe("complained");
  });
  it("refuses conflicting provider IDs and sender mismatches during recovery", async () => {
    const message = await db.emailMessage.findFirstOrThrow({
      where: { providerId: "recovered-provider-id" },
    });
    const operation = await db.operation.findFirstOrThrow({
      where: { resourceId: message.id },
    });
    expect(
      await confirmEmailSend(db, operation.id, "different-provider-id"),
    ).toBe(false);
    expect(
      await confirmEmailSend(
        db,
        operation.id,
        message.providerId!,
        undefined,
        "other@example.test",
      ),
    ).toBe(false);
    expect(
      (await db.emailMessage.findUniqueOrThrow({ where: { id: message.id } }))
        .providerId,
    ).toBe("recovered-provider-id");
  });
  it("creates and sends from workspace inboxes without an agent", async () => {
    const agentCount = await db.agent.count();
    await db.apiKey.create({
      data: {
        organizationId: "one",
        createdBy: "one",
        name: "Workspace",
        prefix: "workspace",
        hash: await hash("workspace-key"),
        scopes: ["inboxes:read", "inboxes:write", "email:send"],
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const response = await req(
      "/v1/inboxes",
      "POST",
      { name: "Workspace inbox", localPart: "workspace-inbox" },
      "workspace-create",
      "workspace-key",
    );
    expect(response.status).toBe(201);
    const inbox = await response.json();
    expect(inbox.agentId).toBeNull();
    expect(await db.agent.count()).toBe(agentCount);
    expect(
      (
        await req(
          `/v1/inboxes/${inbox.id}`,
          "GET",
          undefined,
          "unused",
          "other-key",
        )
      ).status,
    ).toBe(404);
    expect((await req(`/v1/inboxes/${inbox.id}`)).status).toBe(404);
    const currentUsage = await db.workspaceEmailUsage.findUnique({
      where: {
        organizationId_day: {
          organizationId: "one",
          day: new Date().toISOString().slice(0, 10),
        },
      },
    });
    await db.organization.update({
      where: { id: "one" },
      data: { dailyEmailLimit: (currentUsage?.sends ?? 0) + 1 },
    });
    mock.send.mockResolvedValueOnce({
      data: { id: "workspace-provider" },
      error: null,
    });
    const body = {
      to: ["recipient@example.test"],
      subject: "Workspace",
      text: "Hello",
    };
    expect(
      (
        await req(
          `/v1/inboxes/${inbox.id}/messages`,
          "POST",
          body,
          "workspace-send",
          "workspace-key",
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await req(
          `/v1/inboxes/${inbox.id}/messages`,
          "POST",
          body,
          "workspace-over-quota",
          "workspace-key",
        )
      ).status,
    ).toBe(429);
    expect(
      (
        await db.workspaceEmailUsage.findFirstOrThrow({
          where: { organizationId: "one" },
        })
      ).sends,
    ).toBe((currentUsage?.sends ?? 0) + 1);
  });
  it("exposes only safe SMS diagnostics to the originating credential", async () => {
    const failure = {
      kind: "provider_http_error",
      httpStatus: 422,
      providerCodes: ["40001"],
    };
    const operation = await db.operation.create({
      data: {
        organizationId: "one",
        principalId: keyId,
        route: "sms.send:fixture",
        key: "diagnostic",
        requestHash: "fixture",
        status: "failed",
        error: "provider_rejected",
        result: {
          failure,
          webhookUrl: "https://example.test/private-callback",
          internal: "PRIVATE_INTERNAL_DETAILS",
        },
      },
    });
    const response = await req(`/v1/operations/${operation.id}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.failure).toEqual(failure);
    expect(body.result).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("PRIVATE_INTERNAL_DETAILS");
    expect(
      (
        await req(
          `/v1/operations/${operation.id}`,
          "GET",
          undefined,
          "unused",
          "workspace-key",
        )
      ).status,
    ).toBe(404);
    await db.operation.update({
      where: { id: operation.id },
      data: { status: "completed", error: null },
    });
    expect(
      (await (await req(`/v1/operations/${operation.id}`)).json()).failure,
    ).toBeUndefined();
  });
  it("revocation is immediate", async () => {
    await db.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
    expect((await req("/v1/inboxes")).status).toBe(401);
  });
  it("membership removal invalidates existing keys", async () => {
    await db.user.create({
      data: {
        id: "key-successor",
        name: "Successor",
        email: "key-successor@example.test",
      },
    });
    await db.member.create({
      data: {
        id: "key-successor",
        organizationId: "two",
        userId: "key-successor",
        role: "owner",
        createdAt: new Date(),
      },
    });
    await db.member.delete({ where: { id: "two" } });
    expect(
      (await req("/v1/inboxes", "GET", undefined, "one", "other-key")).status,
    ).toBe(401);
  });
  it("applies workspace email and inbox limits to legacy agent resources", async () => {
    const inbox = await db.inbox.findFirstOrThrow({ where: { agentId } });
    await db.agent.update({
      where: { id: agentId },
      data: { dailySendLimit: 10000, maxInboxes: 100 },
    });
    await db.organization.update({
      where: { id: "one" },
      data: { dailyEmailLimit: 0, maxInboxes: 0 },
    });
    const calls = mock.send.mock.calls.length;
    const sent = await req(
      `/v1/inboxes/${inbox.id}/messages`,
      "POST",
      { to: ["recipient@example.test"], subject: "Paused", text: "Hello" },
      "legacy-paused",
      "workspace-key",
    );
    expect(sent.status).toBe(429);
    expect(mock.send.mock.calls.length).toBe(calls);
    const created = await req(
      "/v1/inboxes",
      "POST",
      { name: "Blocked", localPart: "legacy-paused", agentId },
      "legacy-inbox-paused",
      "workspace-key",
    );
    expect(created.status).toBe(409);
    expect(
      await db.inbox.count({
        where: { address: "legacy-paused@example.test" },
      }),
    ).toBe(0);
  });
  it("denies workspace policy administration through API keys", async () => {
    expect(
      (
        await req(
          "/v1/workspace/policy",
          "GET",
          undefined,
          "unused",
          "workspace-key",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await req(
          "/v1/workspace/policy",
          "PATCH",
          {
            dailyEmailLimit: 100,
            dailySmsLimit: 100,
            maxInboxes: 10,
            maxPhoneNumbers: 5,
          },
          "unused",
          "workspace-key",
        )
      ).status,
    ).toBe(403);
  });
});
