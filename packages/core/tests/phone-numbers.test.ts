import {
  numberOperationSchema,
  availableNumberResultsSchema,
} from "../../contracts/src/responses";
import { TelnyxProvider } from "@agentinfra/providers";
import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { createDatabase } from "@agentinfra/db";
import {
  provisionNumber,
  releaseNumber,
  reconcilePhoneNumbers,
} from "../src/phone-numbers";
import { sendSms } from "../src/sms";
import type { Principal } from "../src/principal";
const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_test",
);
const fetcher = vi.fn<typeof fetch>();
const env = {
  TELNYX_STATUS: "active",
  TELNYX_API_KEY: "test",
  TELNYX_PUBLIC_KEY: "test",
  TELNYX_MESSAGING_PROFILE_ID: "profile",
};
const p: Principal = {
  id: "key",
  userId: "owner",
  organizationId: "workspace",
  role: "agent",
  scopes: ["numbers:provision", "numbers:release", "sms:send"],
};
const input = {
  country: "US",
  phoneNumber: "+12025550101",
  monthlyCost: "1.00",
  upfrontCost: "1.00",
  currency: "USD",
};
const quote = (phone = input.phoneNumber, monthly = "1.00000") =>
  Response.json({
    data: [
      {
        phone_number: phone,
        cost_information: {
          monthly_cost: monthly,
          upfront_cost: "1.00000",
          currency: "USD",
        },
        features: [{ name: "sms" }],
      },
    ],
  });
const order = (reference?: string) => ({
  id: "order",
  customer_reference: reference,
  status: "success",
  requirements_met: true,
  phone_numbers: [{ phone_number: input.phoneNumber, status: "success" }],
});
beforeAll(() => vi.stubGlobal("fetch", fetcher));
beforeEach(async () => {
  fetcher.mockReset();
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "organization", "user", "Operation", "ProviderEvent" CASCADE',
  );
  await db.organization.create({
    data: {
      id: p.organizationId,
      name: "Workspace",
      slug: "workspace",
      createdAt: new Date(),
      dailySmsLimit: 1,
    },
  });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await db.$disconnect();
});
async function buy() {
  fetcher
    .mockResolvedValueOnce(quote())
    .mockResolvedValueOnce(Response.json({ data: order() }));
  return provisionNumber(db, env, p, input, "purchase");
}
it("returns documented search prices without losing decimal precision or optional region metadata", async () => {
  const result = await quote(input.phoneNumber, "1.0000000001").json();
  result.data[0].phone_number_type = "local";
  result.data[0].region_information = [
    { region_name: "DC", region_type: "state" },
  ];
  fetcher.mockResolvedValueOnce(Response.json(result));
  const found = await new TelnyxProvider(
    env.TELNYX_API_KEY,
    env.TELNYX_STATUS,
  ).search("US");
  expect(availableNumberResultsSchema.parse(found)).toEqual(result);
  expect(found.data[0]?.cost_information.monthly_cost).toBe("1.0000000001");
  const url = new URL(fetcher.mock.calls[0]![0] as string);
  expect(url.searchParams.get("filter[country_code]")).toBe("US");
  expect(url.searchParams.get("filter[features][]")).toBe("sms");
  fetcher.mockResolvedValueOnce(Response.json({ data: [] }));
  expect(
    availableNumberResultsSchema.parse(
      await new TelnyxProvider(env.TELNYX_API_KEY, env.TELNYX_STATUS).search(
        "FR",
      ),
    ),
  ).toEqual({ data: [] });
});
async function activate() {
  fetcher
    .mockResolvedValueOnce(Response.json({ data: order() }))
    .mockResolvedValueOnce(
      Response.json({
        data: [
          { id: "owned", phone_number: input.phoneNumber, status: "active" },
        ],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        data: {
          phone_number: input.phoneNumber,
          messaging_profile_id: "profile",
        },
      }),
    );
  await reconcilePhoneNumbers(db, env);
}
it("purchases once concurrently without an agent and activates only after assignment is verified", async () => {
  fetcher
    .mockResolvedValueOnce(quote())
    .mockResolvedValueOnce(Response.json({ data: order() }));
  const results = await Promise.all([
    provisionNumber(db, env, p, input, "purchase"),
    provisionNumber(db, env, p, input, "purchase"),
  ]);
  expect(
    results.every(
      (result) => numberOperationSchema.safeParse(result.body).success,
    ),
  ).toBe(true);
  expect(results[0]!.body.id).toBe(results[1]!.body.id);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const searchUrl = new URL(fetcher.mock.calls[0]![0] as string);
  expect(searchUrl.searchParams.get("filter[phone_number][starts_with]")).toBe(
    "2025550101",
  );
  expect(searchUrl.searchParams.get("filter[best_effort]")).toBe("false");
  const submitted = JSON.parse(fetcher.mock.calls[1]![1]!.body as string);
  expect(submitted).toMatchObject({
    messaging_profile_id: "profile",
    customer_reference: results[0]!.body.id,
  });
  expect((await db.phoneNumber.findFirstOrThrow()).agentId).toBeNull();
  expect(await db.agent.count()).toBe(0);
  expect((await db.phoneNumber.findFirstOrThrow()).status).toBe("pending");
  await activate();
  expect((await db.phoneNumber.findFirstOrThrow()).status).toBe("active");
  expect((await db.operation.findFirstOrThrow()).status).toBe("completed");
  expect(await db.event.count({ where: { type: "number.activated" } })).toBe(1);
});
it("rejects unauthorized purchasing, changed idempotency input, and workspace quota", async () => {
  await expect(
    provisionNumber(db, env, { ...p, scopes: [] }, input, "key"),
  ).rejects.toMatchObject({ code: "insufficient_scope" });
  await expect(
    provisionNumber(db, env, { ...p, role: "member" }, input, "key"),
  ).rejects.toMatchObject({ code: "forbidden" });
  await buy();
  await expect(
    provisionNumber(db, env, p, { ...input, monthlyCost: "2" }, "purchase"),
  ).rejects.toMatchObject({ code: "idempotency_conflict" });
  await db.organization.update({
    where: { id: p.organizationId },
    data: { maxPhoneNumbers: 1 },
  });
  await expect(
    provisionNumber(
      db,
      env,
      p,
      { ...input, phoneNumber: "+12025550102" },
      "another",
    ),
  ).rejects.toMatchObject({ code: "quota_exceeded" });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("does not purchase when the price changed", async () => {
  fetcher.mockResolvedValueOnce(quote(input.phoneNumber, "2.00"));
  const result = await provisionNumber(db, env, p, input, "price");
  expect(result.body).toMatchObject({
    status: "failed",
    error: "price_changed",
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([
  ["monthlyCost", "monthly_cost", "1.00000000000000001", "1.00000000000000002"],
  ["upfrontCost", "upfront_cost", "1.00000000000000001", "1.00000000000000002"],
  ["monthlyCost", "monthly_cost", "1" + "0".repeat(309), "2" + "0".repeat(309)],
] as const)(
  "rejects a changed %s even when floating point values would be equal",
  async (inputField, quoteField, acceptedPrice, newPrice) => {
    const current = await quote().json();
    current.data[0].cost_information[quoteField] = newPrice;
    fetcher.mockResolvedValueOnce(Response.json(current));
    const result = await provisionNumber(
      db,
      env,
      p,
      { ...input, [inputField]: acceptedPrice },
      "exact-price",
    );
    expect(result.body).toMatchObject({
      status: "failed",
      error: "price_changed",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      fetcher.mock.calls.some(([, options]) => options?.method === "POST"),
    ).toBe(false);
  },
);
it("accepts equivalent price strings with leading and trailing zeroes", async () => {
  fetcher
    .mockResolvedValueOnce(quote(input.phoneNumber, "0001.00000"))
    .mockResolvedValueOnce(Response.json({ data: order() }));
  const result = await provisionNumber(
    db,
    env,
    p,
    { ...input, monthlyCost: "1", upfrontCost: "01.00" },
    "equivalent-price",
  );
  expect(result.body.status).toBe("pending");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("recovers a lost order response using the reference without ordering twice", async () => {
  fetcher
    .mockResolvedValueOnce(quote())
    .mockRejectedValueOnce(new Error("timeout"));
  const result = await provisionNumber(db, env, p, input, "timeout");
  expect(result.body.status).toBe("unknown");
  expect((await provisionNumber(db, env, p, input, "timeout")).body.id).toBe(
    result.body.id,
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  await db.phoneNumber.updateMany({ data: { nextReconcileAt: new Date(0) } });
  fetcher.mockResolvedValueOnce(
    Response.json({ data: [order(result.body.id)] }),
  );
  await activate();
  expect((await db.operation.findFirstOrThrow()).status).toBe("completed");
  expect(
    fetcher.mock.calls.filter(([, options]) => options?.method === "POST"),
  ).toHaveLength(1);
});
it("holds regulatory orders pending and never marks them usable", async () => {
  await buy();
  fetcher.mockResolvedValueOnce(
    Response.json({ data: { ...order(), requirements_met: false } }),
  );
  await reconcilePhoneNumbers(db, env);
  expect((await db.phoneNumber.findFirstOrThrow()).status).toBe(
    "awaiting_requirements",
  );
  expect((await db.operation.findFirstOrThrow()).status).toBe("pending");
});
it("isolates release, retains SMS history, and reconciles a timed-out delete", async () => {
  const bought = await buy();
  await activate();
  const id = bought.body.numberId!;
  await expect(
    releaseNumber(db, env, { ...p, organizationId: "other" }, id, "release"),
  ).rejects.toMatchObject({ code: "not_found" });
  await expect(
    releaseNumber(db, env, { ...p, agentId: "legacy" }, id, "release"),
  ).rejects.toMatchObject({ code: "not_found" });
  await db.smsMessage.create({
    data: {
      organizationId: p.organizationId,
      phoneNumberId: id,
      direction: "inbound",
      status: "received",
      from: "+12025550100",
      to: input.phoneNumber,
      text: "History",
    },
  });
  fetcher.mockRejectedValueOnce(new Error("timeout"));
  const released = await releaseNumber(db, env, p, id, "release");
  expect(released.body.status).toBe("unknown");
  await releaseNumber(db, env, p, id, "release");
  await db.phoneNumber.updateMany({ data: { nextReconcileAt: new Date(0) } });
  fetcher.mockResolvedValueOnce(Response.json({}, { status: 404 }));
  await reconcilePhoneNumbers(db, env);
  expect((await db.phoneNumber.findFirstOrThrow()).status).toBe("released");
  expect(
    (await db.operation.findUniqueOrThrow({ where: { id: released.body.id } }))
      .status,
  ).toBe("completed");
  expect(await db.smsMessage.count()).toBe(1);
  expect(
    fetcher.mock.calls.filter(([, options]) => options?.method === "DELETE"),
  ).toHaveLength(1);
  await expect(
    sendSms(db, env, p, id, { to: "+12025550100", text: "No" }, "sms"),
  ).rejects.toMatchObject({ code: "number_inactive" });
});
it("sends with workspace quota and accepts a 204 release", async () => {
  const bought = await buy();
  await activate();
  fetcher.mockResolvedValueOnce(Response.json({ data: { id: "sms" } }));
  const body = { to: "+12025550100", text: "Hello" };
  expect(
    (await sendSms(db, env, p, bought.body.numberId!, body, "sms")).body.status,
  ).toBe("completed");
  await expect(
    sendSms(db, env, p, bought.body.numberId!, body, "over"),
  ).rejects.toMatchObject({ code: "quota_exceeded" });
  fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }));
  expect(
    (await releaseNumber(db, env, p, bought.body.numberId!, "release")).body
      .status,
  ).toBe("completed");
  expect((await db.workspaceEmailUsage.findFirstOrThrow()).smsSends).toBe(1);
});

it("allows a new purchase attempt after a definitive failure, preserving old operation results", async () => {
  fetcher.mockResolvedValueOnce(quote(input.phoneNumber, "2.00"));
  const failed = await provisionNumber(db, env, p, input, "old");
  const retried = await buy();
  expect(retried.body.id).not.toBe(failed.body.id);
  expect(
    (await db.operation.findUniqueOrThrow({ where: { id: failed.body.id } }))
      .status,
  ).toBe("failed");
  await activate();
  expect(
    (await db.operation.findUniqueOrThrow({ where: { id: retried.body.id } }))
      .status,
  ).toBe("completed");
  expect(await db.phoneNumber.count()).toBe(1);
});

it("requires exact purchase approval before reserving a number and still rejects price changes", async () => {
  const { decideApproval } = await import("../src/approvals");
  await db.organization.update({
    where: { id: p.organizationId },
    data: { requireProvisioningApproval: true },
  });
  await expect(
    provisionNumber(db, env, p, input, "review"),
  ).rejects.toMatchObject({ code: "approval_required" });
  expect(await db.phoneNumber.count()).toBe(0);
  expect(await db.operation.count()).toBe(0);
  expect(fetcher).not.toHaveBeenCalled();
  const approval = await db.approval.findFirstOrThrow();
  expect(approval.parameters).toMatchObject(input);
  await decideApproval(
    db,
    {
      ...p,
      id: "owner",
      role: "owner",
      credential: { kind: "session", id: "session" },
    },
    approval.id,
    "approved",
  );
  await expect(
    provisionNumber(db, env, p, { ...input, monthlyCost: "2.00" }, "review"),
  ).rejects.toMatchObject({ code: "idempotency_conflict" });
  fetcher.mockResolvedValueOnce(quote(input.phoneNumber, "2.00"));
  const failed = await provisionNumber(db, env, p, input, "review");
  expect(failed.body.status).toBe("failed");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(
    (await db.approval.findUniqueOrThrow({ where: { id: approval.id } }))
      .status,
  ).toBe("consumed");
  await provisionNumber(db, env, p, input, "review");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("reserves a key purchase allowance before provider calls and does not recount replay", async () => {
  await db.user.create({
    data: { id: "owner", name: "Owner", email: "owner@example.test" },
  });
  const key = await db.apiKey.create({
    data: {
      organizationId: "workspace",
      createdBy: "owner",
      name: "Key",
      prefix: "key",
      hash: "fixture",
      scopes: ["numbers:provision"],
      expiresAt: new Date(Date.now() + 60000),
      dailyNumberLimit: 1,
    },
  });
  const principal: Principal = {
    ...p,
    credential: { kind: "key", id: key.id },
  };
  fetcher
    .mockResolvedValueOnce(quote())
    .mockResolvedValueOnce(Response.json({ data: order() }));
  const results = await Promise.allSettled([
    provisionNumber(db, env, principal, input, "first"),
    provisionNumber(
      db,
      env,
      principal,
      { ...input, phoneNumber: "+12025550102" },
      "second",
    ),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    (results.find((r) => r.status === "rejected") as PromiseRejectedResult)
      .reason,
  ).toMatchObject({ status: 429, code: "quota_exceeded" });
  const firstWon = results[0]!.status === "fulfilled";
  const count = fetcher.mock.calls.length;
  await provisionNumber(
    db,
    env,
    principal,
    firstWon ? input : { ...input, phoneNumber: "+12025550102" },
    firstWon ? "first" : "second",
  );
  expect(fetcher).toHaveBeenCalledTimes(count);
  expect((await db.apiKeyDailyUsage.findFirstOrThrow()).numberPurchases).toBe(
    1,
  );
});
