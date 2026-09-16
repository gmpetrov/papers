import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../packages/db/src/index";

// Deliberately isolated from both application data and the main test suite.
const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_jobs_test",
);
const id = "worker-check-" + randomUUID();
const queueMode = process.argv.includes("--queue");
const trigger = async (eventId: string) => {
  const response = await fetch(
    `http://localhost:3002/${queueMode ? "wake" : "__scheduled"}`,
    {
      method: queueMode ? "POST" : "GET",
      signal: AbortSignal.timeout(30000),
    },
  );
  assert.equal(
    response.status,
    queueMode ? 202 : 200,
    "Job notification failed",
  );
  if (queueMode) {
    const deadline = Date.now() + 30000;
    while (
      (await db.providerEvent.findUniqueOrThrow({ where: { id: eventId } }))
        .status !== "completed"
    ) {
      assert.ok(
        Date.now() < deadline,
        "Queue consumer did not process the fixture",
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
};
try {
  await db.organization.create({
    data: { id, name: "Worker fixture", slug: id, createdAt: new Date() },
  });
  await db.phoneNumber.create({
    data: {
      id,
      organizationId: id,
      phoneNumber: "+12025550109",
      messagingProfileId: id,
      status: "active",
    },
  });
  await db.$executeRaw`
    INSERT INTO "ApiRequestBucket" ("organizationId", bucket, "window", count)
    VALUES (${id}, 'expired', floor(extract(epoch FROM CURRENT_TIMESTAMP)/60)::bigint - 1442, 120),
           (${id}, 'active', floor(extract(epoch FROM CURRENT_TIMESTAMP)/60)::bigint, 1)
  `;
  const event = {
    data: {
      id,
      event_type: "message.received",
      occurred_at: new Date().toISOString(),
      payload: {
        id,
        direction: "inbound",
        type: "SMS",
        messaging_profile_id: id,
        from: { phone_number: "+12025550100" },
        to: [{ phone_number: "+12025550109" }],
        text: "STOP",
        autoresponse_type: "STOP",
        parts: 1,
        cost: { amount: "0.004", currency: "USD" },
      },
    },
  };
  // Simulates an event already verified and durably recorded by webhook ingress.
  await db.providerEvent.create({
    data: {
      id,
      provider: "telnyx",
      type: "message.received",
      payload: event,
      availableAt: new Date(0),
    },
  });
  await trigger(id);
  const buckets = await db.apiRequestBucket.findMany({ where: { organizationId: id } });
  assert.deepEqual(buckets.map(bucket => bucket.bucket), ["active"]);
  assert.equal(buckets[0]!.count, 1);
  const messages = await db.smsMessage.findMany({
    where: { organizationId: id },
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.text, event.data.payload.text);
  assert.equal(messages[0]!.segments, 1);
  assert.equal(messages[0]!.costAmount?.toString(), "0.004");
  assert.equal(messages[0]!.costCurrency, "USD");
  const optOut = await db.providerSmsOptOut.findUniqueOrThrow({
    where: {
      messagingProfileId_recipient: {
        messagingProfileId: id,
        recipient: "+12025550100",
      },
    },
  });
  assert.equal(optOut.optedOut, true);
  assert.equal(optOut.eventId, id);

  assert.equal(
    (await db.providerEvent.findUniqueOrThrow({ where: { id } })).status,
    "completed",
  );
  await db.providerEvent.create({
    data: {
      id: id + "-replay",
      provider: "telnyx",
      type: "message.received",
      payload: event,
      availableAt: new Date(0),
    },
  });
  await trigger(id + "-replay");
  assert.equal(await db.smsMessage.count({ where: { organizationId: id } }), 1);
  assert.equal(
    await db.event.count({
      where: { organizationId: id, type: "sms.received" },
    }),
    1,
  );
  console.log(
    `Cloudflare ${queueMode ? "Queue" : "scheduled"} runtime: PostgreSQL connection, incoming SMS processing, provider cost recording, STOP opt-out, duplicate replay, and expired request-counter cleanup passed. No provider API calls made.`,
  );
} finally {
  await db.providerSmsOptOut.deleteMany({ where: { messagingProfileId: id } });
  await db.providerSmsOptOutSync.deleteMany({
    where: { messagingProfileId: id },
  });
  await db.providerEvent.deleteMany({
    where: { id: { in: [id, id + "-replay"] } },
  });
  await db.event.deleteMany({ where: { organizationId: id } });
  await db.organization.deleteMany({ where: { id } });
  await db.$disconnect();
}
