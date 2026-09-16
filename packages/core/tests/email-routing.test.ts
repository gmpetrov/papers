import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { createDatabase } from "../../db/src/index";
import { ingestResend, processProviderEvents } from "../src/webhooks";

const mock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@agentinfra/providers", async (original) => ({
  ...(await original<object>()),
  resendClient: () => ({ emails: { receiving: { get: mock.get } } }),
}));
const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_test",
);
const secret =
  "whsec_" +
  Buffer.from("routing-fixture-secret-32-bytes!!").toString("base64");
const env = { RESEND_API_KEY: "fixture", RESEND_WEBHOOK_SECRET: secret };
const addresses = [
  "first@example.test",
  "second@example.test",
  "header-only@example.test",
  "archived@example.test",
];
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "organization", "user", "ProviderEvent" CASCADE',
  );
  mock.get.mockReset();
  for (const [index, address] of addresses.entries()) {
    const organizationId = `routing-${index}`;
    await db.organization.create({
      data: {
        id: organizationId,
        name: organizationId,
        slug: organizationId,
        createdAt: new Date(),
      },
    });
    await db.inbox.create({
      data: {
        id: organizationId,
        organizationId,
        name: address,
        address,
        status: index === 3 ? "archived" : "active",
      },
    });
  }
});
afterAll(() => db.$disconnect());

async function ingest(id: string, recipients?: string[]) {
  const body = JSON.stringify({
    type: "email.received",
    created_at: new Date().toISOString(),
    data: {
      email_id: "routing-mail",
      to: [addresses[2]],
      received_for: recipients,
    },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  await ingestResend(
    db,
    env,
    new Request("http://localhost/api/webhooks/resend", {
      method: "POST",
      body,
      headers: {
        "svix-id": id,
        "svix-timestamp": timestamp,
        "svix-signature": `v1,${signature}`,
      },
    }),
  );
  await db.providerEvent.update({
    where: { id },
    data: { availableAt: new Date(0) },
  });
}
function mail(recipients?: string[]) {
  return {
    data: {
      id: "routing-mail",
      from: "sender@example.test",
      to: [addresses[2]],
      cc: [addresses[2]],
      bcc: [],
      received_for: recipients,
      subject: "Routing fixture",
      text: "Private message",
      html: null,
      message_id: "<routing@example.test>",
      headers: { To: addresses[2] },
      attachments: [],
      created_at: new Date().toISOString(),
    },
    error: null,
  };
}
it("routes multiple envelope recipients once without disclosing other inbox addresses", async () => {
  const recipients = [
    " FIRST@EXAMPLE.TEST ",
    addresses[1]!,
    addresses[1]!,
    addresses[3]!,
  ];
  mock.get.mockResolvedValue(mail(recipients));
  await ingest("routing-first", recipients);
  await processProviderEvents(db, env);
  // A second event ID for the same provider email must not duplicate messages/events.
  await ingest("routing-replay", recipients);
  await processProviderEvents(db, env);
  const messages = await db.emailMessage.findMany({
    orderBy: { organizationId: "asc" },
  });
  expect(messages).toHaveLength(2);
  expect(messages.map((m) => m.organizationId)).toEqual([
    "routing-0",
    "routing-1",
  ]);
  expect(messages.map((m) => m.to)).toEqual([[addresses[0]], [addresses[1]]]);
  expect(await db.event.count({ where: { type: "email.received" } })).toBe(2);
  expect(
    await db.providerEvent.findMany({
      select: { status: true, payload: true },
    }),
  ).toEqual([
    { status: "completed", payload: { email_id: "routing-mail" } },
    { status: "completed", payload: { email_id: "routing-mail" } },
  ]);
});
it("discards unknown and archived destinations without fetching message content", async () => {
  await ingest("routing-discard", ["unknown@example.test", addresses[3]!]);
  await processProviderEvents(db, env);
  expect(mock.get).not.toHaveBeenCalled();
  expect(await db.emailMessage.count()).toBe(0);
  expect(
    await db.providerEvent.findUniqueOrThrow({
      where: { id: "routing-discard" },
      select: { status: true, payload: true },
    }),
  ).toEqual({ status: "completed", payload: { email_id: "routing-mail" } });
});
it("does not route a visible header when the signed event lacks envelope recipients", async () => {
  await ingest("routing-missing-event");
  await processProviderEvents(db, env);
  expect(mock.get).not.toHaveBeenCalled();
  expect(await db.emailMessage.count()).toBe(0);
  expect(
    (
      await db.providerEvent.findUniqueOrThrow({
        where: { id: "routing-missing-event" },
      })
    ).status,
  ).toBe("pending");
});
it("does not fall back to headers or the webhook when retrieved envelope data is missing", async () => {
  mock.get.mockResolvedValue(mail());
  await ingest("routing-missing-mail", [addresses[0]!]);
  await processProviderEvents(db, env);
  expect(mock.get).toHaveBeenCalledOnce();
  expect(await db.emailMessage.count()).toBe(0);
  expect(
    (
      await db.providerEvent.findUniqueOrThrow({
        where: { id: "routing-missing-mail" },
      })
    ).status,
  ).toBe("pending");
});
