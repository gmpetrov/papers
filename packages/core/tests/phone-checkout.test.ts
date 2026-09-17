import { createApi } from "../src/index";
import type { Auth } from "@agentinfra/auth";
import { beforeEach, afterAll, afterEach, it, expect, vi } from "vitest";
import { createDatabase } from "@agentinfra/db";
import { TelnyxProvider } from "@agentinfra/providers";
import { startCheckout, processStripeEvents } from "../src/stripe-billing";
import { retailNumber, standardNumber } from "../src/phone-retail";
const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_test",
);
const org = "phone-checkout-test";
const owner = {
  id: "owner",
  userId: "owner",
  organizationId: org,
  role: "owner",
  scopes: [],
  credential: { kind: "session" as const, id: "session" },
};
const env = {
  STRIPE_SECRET_KEY: "sk_test_billing",
  BILLING_ENABLED: "true",
  BILLING_PUBLIC_ORIGIN: "https://example.test",
  TELNYX_STATUS: "active",
  TELNYX_API_KEY: "test",
  TELNYX_PUBLIC_KEY: "test",
  TELNYX_MESSAGING_PROFILE_ID: "profile",
};
const quote = {
  phone_number: "+12025550109",
  phone_number_type: "local",
  features: [{ name: "sms" }],
  cost_information: {
    monthly_cost: "1.05",
    upfront_cost: "0.85",
    currency: "USD",
  },
};
let paid = false;
let canceled = false;
let stripeCalls: { path: string; method: string; body: string }[] = [];
let provision: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "organization", "user", "Operation", "ProviderEvent" CASCADE',
  );
  await db.organization.create({
    data: { id: org, name: "Test", slug: org, createdAt: new Date() },
  });
  await db.billingAccount.create({
    data: {
      organizationId: org,
      stripeCustomerId: "cus_phone",
      plan: "developer",
      status: "active",
      periodEnd: new Date(Date.now() + 86400000),
    },
  });
  paid = false;
  canceled = false;
  stripeCalls = [];
  vi.spyOn(TelnyxProvider.prototype, "search").mockResolvedValue({
    data: [quote],
  });
  provision = vi
    .spyOn(TelnyxProvider.prototype, "provision")
    .mockResolvedValue({
      id: "order_phone",
      status: "pending",
      phone_numbers: [],
    });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      const method = init?.method ?? "GET";
      stripeCalls.push({ path, method, body: String(init?.body ?? "") });
      let data: unknown;
      if (path === "/v1/prices") data = { data: [{ id: "price_phone" }] };
      else if (path === "/v1/prices/price_phone")
        data = { lookup_key: "papers_us_number_monthly_v1" };
      else if (path === "/v1/checkout/sessions")
        data = { id: "cs_phone", url: "https://checkout.stripe.com/phone" };
      else if (path === "/v1/subscriptions/sub_phone") {
        if (method === "DELETE") canceled = true;
        data = {
          id: "sub_phone",
          customer: "cus_phone",
          status: canceled ? "canceled" : "active",
          cancel_at_period_end: false,
          metadata: {
            papers_organization_id: org,
            papers_kind: "phone",
            papers_checkout_id: `${org}:selected-phone`,
          },
          latest_invoice: {
            id: "in_phone",
            status: paid ? "paid" : "open",
            amount_paid: paid ? 300 : 0,
          },
          items: {
            data: [
              {
                price: { id: "price_phone" },
                current_period_end: Math.floor(Date.now() / 1000) + 86400,
              },
            ],
          },
        };
      } else if (path === "/v1/invoice_payments")
        data = {
          data: [
            {
              id: "ip_phone",
              amount_paid: 300,
              payment: { payment_intent: "pi_phone" },
            },
          ],
        };
      else if (path === "/v1/refunds")
        data =
          method === "POST"
            ? { id: "re_phone", status: "succeeded" }
            : { data: [] };
      else throw new Error(`Unexpected Stripe request ${path}`);
      return Response.json(data);
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
afterAll(() => db.$disconnect());
async function checkout() {
  return startCheckout(
    db,
    env,
    owner,
    { kind: "phone", country: "US", phoneNumber: quote.phone_number },
    "selected-phone",
  );
}
async function event(id: string) {
  await db.providerEvent.create({
    data: {
      id,
      provider: "stripe",
      type: "customer.subscription.updated",
      availableAt: new Date(0),
      payload: {
        type: "customer.subscription.updated",
        data: { object: { id: "sub_phone" } },
      },
    },
  });
  await processStripeEvents(db, env);
  expect(
    (await db.providerEvent.findUniqueOrThrow({ where: { id } })).status,
  ).toBe("completed");
}
it("starts Stripe at number selection and provisions only after verified payment, once", async () => {
  await expect(checkout()).resolves.toEqual({
    url: "https://checkout.stripe.com/phone",
  });
  expect(provision).not.toHaveBeenCalled();
  const request = stripeCalls.find((c) => c.path === "/v1/checkout/sessions")!;
  expect(decodeURIComponent(request.body)).toContain(
    "/dashboard/numbers?checkout=success",
  );
  expect(request.body).not.toContain("1.05");
  expect(request.body).not.toContain("0.85");
  await event("unpaid");
  expect(provision).not.toHaveBeenCalled();
  paid = true;
  await event("paid");
  await event("duplicate");
  expect(provision).toHaveBeenCalledTimes(1);
  const rental = await db.phoneRental.findUniqueOrThrow({
    where: { id: "sub_phone" },
  });
  expect(rental.phoneNumberId).toBeTruthy();
  const number = await db.phoneNumber.findUniqueOrThrow({
    where: { id: rental.phoneNumberId! },
  });
  expect(number.phoneNumber).toBe(quote.phone_number);
  expect(
    (
      await db.billingAccount.findUniqueOrThrow({
        where: { organizationId: org },
      })
    ).balanceMicros,
  ).toBe(500000n);
});
it("cancels and refunds a paid rental when the selected number disappears", async () => {
  await checkout();
  paid = true;
  vi.mocked(TelnyxProvider.prototype.search).mockResolvedValue({ data: [] });
  await event("unavailable");
  await event("retry");
  expect(provision).not.toHaveBeenCalled();
  expect(
    stripeCalls.filter((c) => c.path === "/v1/refunds" && c.method === "POST"),
  ).toHaveLength(1);
  expect(canceled).toBe(true);
  expect(
    (
      await db.billingCheckout.findUniqueOrThrow({
        where: { id: `${org}:selected-phone` },
      })
    ).status,
  ).toBe("refunded");
  expect(
    (
      await db.billingAccount.findUniqueOrThrow({
        where: { organizationId: org },
      })
    ).balanceMicros,
  ).toBe(0n);
});
it("inventory exposes retail prices and excludes non-standard inventory", () => {
  expect(standardNumber("US", quote)).toBe(true);
  const retail = retailNumber(quote);
  expect(retail.cost_information).toEqual({
    monthly_cost: "3.00",
    upfront_cost: "0.00",
    currency: "USD",
  });
  expect(JSON.stringify(retail)).not.toContain("1.05");
  expect(JSON.stringify(retail)).not.toContain("0.85");
  expect(
    standardNumber("US", { ...quote, phone_number_type: "toll_free" }),
  ).toBe(false);
});

it("does not refund or reorder an ambiguous provider submission", async () => {
  await checkout();
  paid = true;
  provision.mockRejectedValue(new Error("network timeout"));
  await event("ambiguous");
  await event("ambiguous-retry");
  expect(provision).toHaveBeenCalledTimes(1);
  expect(
    (await db.phoneNumber.findFirstOrThrow({ where: { organizationId: org } }))
      .status,
  ).toBe("unknown");
  expect(stripeCalls.filter((c) => c.path === "/v1/refunds")).toHaveLength(0);
});

it("customer APIs never return stored provider prices or message costs", async () => {
  await db.user.create({
    data: {
      id: "owner",
      name: "Owner",
      email: "owner@retail.invalid",
      emailVerified: true,
    },
  });
  await db.member.create({
    data: {
      id: "retail-owner",
      organizationId: org,
      userId: "owner",
      role: "owner",
      createdAt: new Date(),
    },
  });
  const auth = {
    options: {
      baseURL: "https://example.test",
      secret: "retail-test-secret-long-enough-for-auth",
    },
    api: {
      getSession: async () => ({
        user: { id: "owner" },
        session: { activeOrganizationId: org },
      }),
    },
  } as unknown as Auth;
  const api = createApi(db, auth, env);
  const number = await db.phoneNumber.create({
    data: {
      organizationId: org,
      phoneNumber: quote.phone_number,
      messagingProfileId: "profile",
      status: "active",
      monthlyCost: "1.05",
      upfrontCost: "0.85",
      currency: "USD",
    },
  });
  const sms = await db.smsMessage.create({
    data: {
      organizationId: org,
      phoneNumberId: number.id,
      from: quote.phone_number,
      to: "+12025550110",
      direction: "outbound",
      status: "delivered",
      costAmount: "0.012345",
      costCurrency: "USD",
    },
  });
  await db.billingReservation.create({
    data: {
      id: sms.id,
      organizationId: org,
      amountMicros: 30000n,
      settledMicros: 24690n,
      status: "settled",
    },
  });
  for (const path of [
    "/phone-numbers/available?country=US",
    "/phone-numbers",
    `/phone-numbers/${number.id}/messages`,
    `/sms/${sms.id}`,
  ]) {
    const response = await api.request(`https://example.test/v1${path}`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain('"1.05"');
    expect(body).not.toContain('"0.85"');
    expect(body).not.toContain('"0.012345"');
    if (path.includes("messages") || path.startsWith("/sms"))
      expect(body).toContain('"0.024690"');
    else expect(body).toContain('"3.00"');
  }
});
