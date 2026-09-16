import { attachmentLinkSchema, emailDetailSchema } from "../../contracts/src/responses";
import { beforeEach, afterAll, it, expect, vi } from "vitest";
import { createDatabase } from "@agentinfra/db";
import { createAuth } from "@agentinfra/auth";
import { createApi } from "../src/index";
import {
  processAttachments,
  attachmentDisposition,
  maxAttachmentBytes,
} from "../src/attachments";
import { hash } from "../src/errors";
import {
  issueAttachmentLink,
  verifyAttachmentLink,
} from "../src/attachment-links";
const provider = vi.hoisted(() => vi.fn());
vi.mock("@agentinfra/providers", async (original) => ({
  ...(await original<object>()),
  resendClient: () => ({
    emails: { receiving: { attachments: { get: provider } } },
  }),
}));
const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_test",
);
const fetcher = vi.fn<typeof fetch>();
const objects = new Map<string, ArrayBuffer>();
const bucket = {
  put: vi.fn(async (key: string, value: ArrayBuffer) => {
    objects.set(key, value);
    return {};
  }),
  get: vi.fn(async (key: string) => {
    const value = objects.get(key);
    return value
      ? { body: new Response(value).body!, size: value.byteLength }
      : null;
  }),
};
const env = { RESEND_API_KEY: "test", ATTACHMENTS: bucket };
const auth = createAuth(db, {
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "attachments-test-secret-long-enough",
});
const api = createApi(db, auth, env);
beforeEach(async () => {
  vi.stubGlobal("fetch", fetcher);
  vi.clearAllMocks();
  objects.clear();
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "organization", "user", "Operation", "ProviderEvent" CASCADE',
  );
  for (const id of ["one", "two"]) {
    await db.user.create({
      data: { id, name: id, email: `${id}@example.test` },
    });
    await db.organization.create({
      data: { id, name: id, slug: id, createdAt: new Date() },
    });
    await db.member.create({
      data: {
        id,
        userId: id,
        organizationId: id,
        role: "owner",
        createdAt: new Date(),
      },
    });
    await db.apiKey.create({
      data: {
        id,
        organizationId: id,
        createdBy: id,
        name: "Test",
        prefix: id,
        hash: await hash(id),
        scopes: ["inboxes:read"],
        expiresAt: new Date(Date.now() + 60000),
      },
    });
  }
  const project = await db.project.create({ data: { organizationId: "one" } });
  await db.agent.create({
    data: {
      id: "legacy",
      organizationId: "one",
      projectId: project.id,
      name: "Legacy",
    },
  });
  await db.apiKey.create({
    data: {
      organizationId: "one",
      createdBy: "one",
      agentId: "legacy",
      name: "Restricted",
      prefix: "restricted",
      hash: await hash("restricted"),
      scopes: ["inboxes:read"],
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  await db.inbox.create({
    data: {
      id: "inbox",
      organizationId: "one",
      name: "Inbox",
      address: "inbox@example.test",
    },
  });
  await db.emailMessage.create({
    data: {
      id: "message",
      organizationId: "one",
      inboxId: "inbox",
      providerId: "received",
      threadId: "thread",
      direction: "inbound",
      status: "received",
      from: "sender@example.test",
      to: ["inbox@example.test"],
      subject: "File",
    },
  });
  await db.attachment.create({
    data: {
      id: "attachment",
      messageId: "message",
      providerId: "provider-attachment",
      filename: 'file\r\n".html',
      contentType: "text/html",
      size: 4,
      nextStorageAttemptAt: new Date(0),
    },
  });
  provider.mockResolvedValue({
    data: {
      id: "provider-attachment",
      size: 4,
      download_url: "https://inbound-cdn.resend.com/file?signature=test",
    },
    error: null,
  });
  fetcher.mockImplementation(async () => new Response("test"));
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await db.$disconnect();
});
const request = (key: string) =>
  api.request("http://localhost:3000/v1/attachments/attachment/download", {
    headers: { Authorization: `Bearer ${key}` },
  });

it("issues short-lived links and rechecks current credentials on every download", async () => {
  await processAttachments(db, env);
  const mint = (key = "one", id = "attachment") =>
    api.request(`http://localhost:3000/v1/attachments/${id}/download-url`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
    });
  expect((await mint("two")).status).toBe(404);
  expect((await mint("restricted")).status).toBe(404);
  const minted = await mint();
  expect(minted.status).toBe(200);
  const link = await minted.json();
  expect(attachmentLinkSchema.safeParse(link).success).toBe(true);
  expect(new URL(link.url).origin).toBe("http://localhost:3000");
  const response = await api.request(link.url);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("test");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  const altered = new URL(link.url);
  altered.pathname = altered.pathname.replace("/attachment/", "/another/");
  expect((await api.request(altered.href)).status).toBe(401);
  altered.pathname = new URL(link.url).pathname;
  altered.searchParams.set(
    "token",
    altered.searchParams.get("token")!.replace(/^./, "!"),
  );
  expect((await api.request(altered.href)).status).toBe(401);
  await db.apiKey.update({ where: { id: "one" }, data: { scopes: [] } });
  expect((await api.request(link.url)).status).toBe(403);
  await db.apiKey.update({
    where: { id: "one" },
    data: { scopes: ["inboxes:read"], revokedAt: new Date() },
  });
  expect((await api.request(link.url)).status).toBe(401);
  expect(
    await db.auditEvent.count({ where: { action: "attachment.link_created" } }),
  ).toBe(1);
});

it("verifies link signature, audience, and expiry without accepting an extended lifetime", async () => {
  const now = 1800000000000;
  const input = {
    attachmentId: "attachment",
    organizationId: "one",
    credential: { kind: "key" as const, id: "one" },
    resourcePath: "/v1" as const,
    audience: "https://papers.test",
  };
  const link = await issueAttachmentLink("secret", input, now);
  expect(
    (
      await verifyAttachmentLink(
        "secret",
        link.token,
        input.audience,
        now + 59000,
      )
    ).attachmentId,
  ).toBe("attachment");
  await expect(
    verifyAttachmentLink("secret", link.token, input.audience, now + 60000),
  ).rejects.toMatchObject({ code: "invalid_download_link" });
  await expect(
    verifyAttachmentLink("wrong", link.token, input.audience, now),
  ).rejects.toMatchObject({ code: "invalid_download_link" });
  await expect(
    verifyAttachmentLink("secret", link.token, "https://other.test", now),
  ).rejects.toMatchObject({ code: "invalid_download_link" });
  const [payload, signature] = link.token.split(".");
  const forged = JSON.parse(Buffer.from(payload!, "base64url").toString());
  forged.expiresAt += 600;
  await expect(
    verifyAttachmentLink(
      "secret",
      `${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${signature}`,
      input.audience,
      now,
    ),
  ).rejects.toMatchObject({ code: "invalid_download_link" });
});

it("rechecks signed session access after expiry, workspace changes, and logout", async () => {
  await processAttachments(db, env);
  await db.session.create({
    data: {
      id: "link-session",
      token: "not-a-real-cookie",
      userId: "one",
      activeOrganizationId: "one",
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  const signed = await issueAttachmentLink(auth.options.secret!, {
    attachmentId: "attachment",
    organizationId: "one",
    credential: { kind: "session", id: "link-session" },
    resourcePath: "/v1",
    audience: auth.options.baseURL as string,
  });
  const url = `http://localhost:3000/v1/attachments/attachment/content?token=${signed.token}`;
  expect((await api.request(url)).status).toBe(200);
  await db.session.update({
    where: { id: "link-session" },
    data: { expiresAt: new Date(0) },
  });
  expect((await api.request(url)).status).toBe(401);
  await db.session.update({
    where: { id: "link-session" },
    data: {
      expiresAt: new Date(Date.now() + 60000),
      activeOrganizationId: "two",
    },
  });
  expect((await api.request(url)).status).toBe(403);
  await db.session.delete({ where: { id: "link-session" } });
  expect((await api.request(url)).status).toBe(401);
});

it("stores once under competing claims and authorizes every private download", async () => {
  const runs = await Promise.all([
    processAttachments(db, env),
    processAttachments(db, env),
  ]);
  expect(runs.reduce((sum, result) => sum + result.stored, 0)).toBe(1);
  expect(bucket.put).toHaveBeenCalledTimes(1);
  const detail = await api.request(
    "http://localhost:3000/v1/messages/message",
    { headers: { Authorization: "Bearer one" } },
  );
  const detailBody = await detail.json();
  expect(emailDetailSchema.safeParse(detailBody).success).toBe(true);
  expect(detailBody.providerId).toBeUndefined();
  const attachmentMetadata = detailBody.attachments[0];
  expect(attachmentMetadata.storageStatus).toBe("ready");
  expect(attachmentMetadata).not.toHaveProperty("objectKey");
  expect(attachmentMetadata).not.toHaveProperty("storageAttempts");
  expect(provider).toHaveBeenCalledWith({
    emailId: "received",
    id: "provider-attachment",
  });
  expect(fetcher.mock.calls[0]![1]).toMatchObject({ redirect: "error" });
  expect(fetcher.mock.calls[0]![1]?.headers).toBeUndefined();
  expect((await request("two")).status).toBe(404);
  expect((await request("restricted")).status).toBe(404);
  expect(bucket.get).not.toHaveBeenCalled();
  const response = await request("one");
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("test");
  expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
  expect(response.headers.get("Content-Disposition")).toMatch(/^attachment;/);
  expect(response.headers.get("Content-Disposition")).not.toMatch(/[\r\n]/);
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(
    await db.auditEvent.count({ where: { action: "attachment.downloaded" } }),
  ).toBe(1);
  await processAttachments(db, env);
  expect(bucket.put).toHaveBeenCalledTimes(1);
  await db.apiKey.update({
    where: { id: "one" },
    data: { revokedAt: new Date() },
  });
  expect((await request("one")).status).toBe(401);
});

it.each([
  "http://inbound-cdn.resend.com/file",
  "https://127.0.0.1/file",
  "https://inbound-cdn.resend.com.evil.test/file",
])("rejects unsafe provider URL %s without fetching", async (url) => {
  provider.mockResolvedValue({
    data: { id: "provider-attachment", size: 4, download_url: url },
  });
  expect(await processAttachments(db, env)).toEqual({ stored: 0 });
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    (await db.attachment.findUniqueOrThrow({ where: { id: "attachment" } }))
      .storageError,
  ).toBe("invalid_download_origin");
});

it("bounds downloads and backs off failed storage without losing message metadata", async () => {
  fetcher.mockImplementation(async () => new Response("too long"));
  await processAttachments(db, env);
  const attachment = await db.attachment.findUniqueOrThrow({
    where: { id: "attachment" },
  });
  expect(attachment.objectKey).toBeNull();
  expect(attachment.storageError).toBe("attachment_size_mismatch");
  expect(attachment.nextStorageAttemptAt.getTime()).toBeGreaterThan(Date.now());
  expect(bucket.put).not.toHaveBeenCalled();
  expect((await request("one")).status).toBe(409);
  const pending = await api.request(
    "http://localhost:3000/v1/messages/message",
    { headers: { Authorization: "Bearer one" } },
  );
  expect((await pending.json()).attachments[0].storageStatus).toBe("pending");
  await processAttachments(db, env);
  expect(provider).toHaveBeenCalledTimes(1);
  await db.attachment.update({
    where: { id: "attachment" },
    data: { nextStorageAttemptAt: new Date(0) },
  });
  provider.mockResolvedValue({
    data: {
      id: "provider-attachment",
      size: maxAttachmentBytes + 1,
      download_url: "https://inbound-cdn.resend.com/file",
    },
  });
  await processAttachments(db, env);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await db.emailMessage.count()).toBe(1);
});

it("reports missing configuration and safely encodes Unicode filenames", async () => {
  expect(await processAttachments(db, {})).toEqual({ stored: 0 });
  const response = await createApi(db, auth, {}).request(
    "http://localhost:3000/v1/attachments/attachment/download",
    { headers: { Authorization: "Bearer one" } },
  );
  expect(response.status).toBe(503);
  expect(attachmentDisposition("résumé.pdf")).toContain(
    "filename*=UTF-8''r%C3%A9sum%C3%A9.pdf",
  );
  expect(() => attachmentDisposition("bad\ud800name")).not.toThrow();
});
