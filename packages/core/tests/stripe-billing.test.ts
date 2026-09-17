import { TelnyxProvider } from "@agentinfra/providers";
import { beforeAll, afterAll, afterEach, it, expect, vi } from "vitest";
import Stripe from "stripe";
import { createDatabase } from "@agentinfra/db";
import { ensureBilling } from "../src/billing-ledger";
import {
  creditPayment,
  ingestStripe,
  processStripeEvents,
  autoTopups,
  startCheckout,
} from "../src/stripe-billing";
const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_test",
);
const env = {
  STRIPE_SECRET_KEY: "sk_test_billing",
  STRIPE_WEBHOOK_SECRET: "whsec_billing",
};
const stripe = new Stripe(env.STRIPE_SECRET_KEY);
const owner = {
  id: "owner",
  userId: "owner",
  organizationId: "stripe-test",
  role: "owner",
  scopes: [],
  credential: { kind: "session" as const, id: "session" },
};
const org = "stripe-test";
beforeAll(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "organization", "user", "Operation", "ProviderEvent" CASCADE',
  );
  await db.organization.create({
    data: { id: org, name: "Stripe", slug: org, createdAt: new Date() },
  });
  await ensureBilling(db, org);
  await db.billingAccount.update({
    where: { organizationId: org },
    data: {
      stripeCustomerId: "cus_test",
      plan: "developer",
      status: "active",
      periodEnd: new Date(Date.now() + 86400000),
    },
  });
  await db.billingCheckout.create({
    data: {
      id: "intent_test",
      organizationId: org,
      kind: "topup",
      selection: "1000",
      amountCents: 1000,
    },
  });
});
afterAll(async () => {
  await db.$disconnect();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: "pi_test",
    object: "payment_intent",
    status: "succeeded",
    customer: "cus_test",
    currency: "usd",
    amount: 1000,
    amount_received: 1000,
    payment_method: "pm_test",
    metadata: { papers_checkout_id: "intent_test" },
    ...overrides,
  } as Stripe.PaymentIntent;
}
it("pending and failed payments never grant funds", async () => {
  const mock = vi.spyOn(stripe.paymentIntents, "retrieve");
  for (const status of [
    "processing",
    "requires_action",
    "requires_payment_method",
    "canceled",
  ]) {
    mock.mockResolvedValue(
      payment({ status }) as Stripe.Response<Stripe.PaymentIntent>,
    );
    await creditPayment(db, stripe, "pi_test");
  }
  expect(await db.billingLedger.count()).toBe(0);
});
it("rejects wrong customer, wrong currency, and wrong payment amount", async () => {
  const mock = vi.spyOn(stripe.paymentIntents, "retrieve");
  for (const patch of [
    { customer: "cus_other" },
    { currency: "eur" },
    { amount_received: 999 },
  ]) {
    mock.mockResolvedValue(
      payment(patch) as Stripe.Response<Stripe.PaymentIntent>,
    );
    await expect(creditPayment(db, stripe, "pi_test")).rejects.toMatchObject({
      code: "payment_mismatch",
    });
  }
  expect(await db.billingLedger.count()).toBe(0);
});
it("concurrent successful callbacks grant credit once and save the payment method", async () => {
  vi.spyOn(stripe.paymentIntents, "retrieve").mockResolvedValue(
    payment() as Stripe.Response<Stripe.PaymentIntent>,
  );
  await Promise.all([1, 2, 3].map(() => creditPayment(db, stripe, "pi_test")));
  const account = await db.billingAccount.findUniqueOrThrow({
    where: { organizationId: org },
  });
  expect(account.balanceMicros).toBe(10000000n);
  expect(account.paymentMethodId).toBe("pm_test");
  expect(await db.billingLedger.count()).toBe(1);
});
it("signed events are durable and idempotent; completed events are not processed twice", async () => {
  const raw = JSON.stringify({
    id: "evt_test",
    object: "event",
    type: "payment_intent.succeeded",
    livemode: false,
    data: { object: { id: "pi_test" } },
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: raw,
    secret: env.STRIPE_WEBHOOK_SECRET,
  });
  const request = () =>
    new Request("https://example.com/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body: raw,
    });
  await ingestStripe(db, env, request());
  await ingestStripe(db, env, request());
  expect(await db.providerEvent.count({ where: { provider: "stripe" } })).toBe(
    1,
  );
  const fetcher = vi.fn(
    async () =>
      new Response(JSON.stringify(payment()), {
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  await processStripeEvents(db, env);
  await processStripeEvents(db, env);
  expect(
    (
      await db.providerEvent.findUniqueOrThrow({
        where: { id: "stripe:evt_test" },
      })
    ).status,
  ).toBe("completed");
  expect(await db.billingLedger.count()).toBe(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("automatic top-up stops at the monthly ceiling without a Stripe request", async () => {
  await db.billingAccount.update({
    where: { organizationId: org },
    data: {
      autoTopup: true,
      balanceMicros: 0n,
      autoTopupAmountCents: 2500,
      autoTopupMonthlyLimitCents: 2500,
    },
  });
  await db.billingCheckout.create({
    data: {
      organizationId: org,
      kind: "auto_topup",
      selection: "2500",
      amountCents: 2500,
      status: "paid",
    },
  });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await autoTopups(db, env);
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["open", "expired", "complete", "expiry_race"])(
  "safely switches an abandoned plan checkout with Stripe state %s",
  async (state) => {
    await db.billingCheckout.deleteMany({
      where: { organizationId: org, kind: "plan" },
    });
    await db.billingCheckout.create({
      data: {
        id: `old-${state}`,
        organizationId: org,
        kind: "plan",
        selection: "scale",
        amountCents: 20000,
        stripeSessionId: "cs_old",
        createdAt: new Date(Date.now() - 25 * 3600000),
      },
    });
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const path = new URL(String(url)).pathname;
        calls.push(path);
        let data: unknown;
        if (path.endsWith("/cs_old/expire")) {
          if (state === "expiry_race")
            return new Response(
              JSON.stringify({
                error: {
                  type: "invalid_request_error",
                  message: "Already completed",
                },
              }),
              { status: 400 },
            );
          data = { id: "cs_old", status: "expired" };
        } else if (path.endsWith("/cs_old"))
          data = {
            id: "cs_old",
            status: state === "expiry_race" ? "open" : state,
            url: "https://checkout.stripe.com/old",
          };
        else if (path.endsWith("/prices"))
          data = { data: [{ id: "price_developer" }] };
        else if (path.endsWith("/checkout/sessions"))
          data = {
            id: "cs_new",
            status: "open",
            url: "https://checkout.stripe.com/new",
          };
        else throw new Error(`Unexpected Stripe call: ${path}`);
        return new Response(JSON.stringify(data), {
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const attempt = startCheckout(
      db,
      { ...env, BILLING_PUBLIC_ORIGIN: "https://example.test" },
      owner,
      { kind: "plan", plan: "developer" },
      `switch-${state}`,
    );
    if (state === "complete" || state === "expiry_race") {
      await expect(attempt).rejects.toThrow();
      expect(calls).not.toContain("/v1/checkout/sessions");
    } else {
      await expect(attempt).resolves.toEqual({
        url: "https://checkout.stripe.com/new",
      });
      expect(
        (
          await db.billingCheckout.findUniqueOrThrow({
            where: { id: `old-${state}` },
          })
        ).status,
      ).toBe("expired");
      expect(calls.includes("/v1/checkout/sessions/cs_old/expire")).toBe(
        state === "open",
      );
    }
  },
);

it("grants phone welcome credit only after payment, once across retries and rentals", async () => {
  const before = (
    await db.billingAccount.findUniqueOrThrow({
      where: { organizationId: org },
    })
  ).balanceMicros;
  let paid = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      const data = path.includes("/prices/")
        ? { lookup_key: "papers_us_number_monthly_v1" }
        : {
            id: path.split("/").pop(),
            customer: "cus_test",
            status: "active",
            metadata: { papers_organization_id: org, papers_kind: "phone" },
            latest_invoice: {
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
            cancel_at_period_end: false,
          };
      return new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
  for (const [index, rental] of [
    "sub_first",
    "sub_first",
    "sub_first",
    "sub_second",
  ].entries()) {
    paid = index > 0;
    await db.providerEvent.create({
      data: {
        id: `stripe:welcome-${index}`,
        provider: "stripe",
        type: "customer.subscription.updated",
        availableAt: new Date(0),
        payload: {
          type: "customer.subscription.updated",
          data: { object: { id: rental } },
        },
      },
    });
    await processStripeEvents(db, env);
    const balance = (
      await db.billingAccount.findUniqueOrThrow({
        where: { organizationId: org },
      })
    ).balanceMicros;
    expect(balance - before).toBe(paid ? 500000n : 0n);
  }
  expect(
    await db.billingLedger.count({ where: { key: `phone-welcome:${org}` } }),
  ).toBe(1);
});

it("phone checkout succeeds with zero balance and no activation flag", async () => {
  await db.billingAccount.update({
    where: { organizationId: org },
    data: { balanceMicros: 0n, blocked: false },
  });
  vi.spyOn(TelnyxProvider.prototype, "search").mockResolvedValue({
    data: [
      {
        phone_number: "+12025550109",
        phone_number_type: "local",
        features: [{ name: "sms" }],
        cost_information: {
          monthly_cost: "1",
          upfront_cost: "1",
          currency: "USD",
        },
      },
    ],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      const data = path.endsWith("/prices")
        ? { data: [{ id: "price_phone" }] }
        : { id: "cs_phone", url: "https://checkout.stripe.com/phone" };
      return new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
  await expect(
    startCheckout(
      db,
      { ...env, BILLING_PUBLIC_ORIGIN: "https://example.test" },
      owner,
      { kind: "phone", country: "US", phoneNumber: "+12025550109" },
      "zero-balance-phone",
    ),
  ).resolves.toEqual({ url: "https://checkout.stripe.com/phone" });
});
