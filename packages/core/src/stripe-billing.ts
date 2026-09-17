import { selectedNumberQuote } from "./phone-retail";
import { provisionNumber } from "./phone-numbers";
import Stripe from "stripe";
import { z } from "zod";
import { type Database, Prisma } from "@agentinfra/db";
import {
  plans,
  billingCheckoutInput,
  autoTopupInput,
  changePlanInput,
} from "@agentinfra/contracts";
import type { Environment } from "./index";
import type { Principal } from "./principal";
import { assert, AppError } from "./errors";
import {
  billingLock,
  billingPeriod,
  effectivePlan,
  ensureBilling,
  ledgerEntry,
  receivingReserve,
  USD,
} from "./billing-ledger";

export function stripeClient(env: Environment) {
  assert(
    env.STRIPE_SECRET_KEY,
    503,
    "billing_unavailable",
    "Billing is not configured",
  );
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 1,
    timeout: 15000,
  });
}
export function billingOwner(p: Principal) {
  assert(
    p.credential?.kind === "session" && p.role === "owner" && !p.impersonatedBy,
    403,
    "forbidden",
    "Only the workspace owner can manage billing in their own session",
  );
}
export async function billingSummary(db: Database, p: Principal) {
  assert(
    p.credential?.kind === "session" &&
      ["owner", "admin"].includes(p.role) &&
      !p.impersonatedBy,
    403,
    "forbidden",
    "Workspace admin session required",
  );
  await ensureBilling(db, p.organizationId);
  return db.$transaction(async (tx) => {
    await billingLock(tx, p.organizationId);
    const a = await tx.billingAccount.findUniqueOrThrow({
      where: { organizationId: p.organizationId },
    });
    const reserve = await receivingReserve(tx, p.organizationId);
    const [ledger, rentals, usage, rates] = await Promise.all([
      tx.billingLedger.findMany({
        where: { organizationId: p.organizationId },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      tx.phoneRental.findMany({
        where: {
          organizationId: p.organizationId,
          status: { not: "canceled" },
        },
      }),
      tx.billingEmailUsage.aggregate({
        where: {
          organizationId: p.organizationId,
          period: billingPeriod(a),
          status: { not: "released" },
        },
        _sum: { units: true },
      }),
      tx.smsRate.findMany({
        where: { expiresAt: { gt: new Date() } },
        orderBy: { prefix: "asc" },
      }),
    ]);
    return {
      plan: effectivePlan(a).name.toLowerCase(),
      status: a.status,
      periodEnd: a.periodEnd,
      balanceMicros: a.balanceMicros.toString(),
      reservedMicros: a.reservedMicros.toString(),
      receivingReserveMicros: "0",
      papersReceivingBufferMicros: reserve.toString(),
      availableMicros: (a.balanceMicros - a.reservedMicros).toString(),
      blocked: a.blocked,
      emailUsage: usage._sum.units ?? 0,
      emailAllowance: effectivePlan(a).emails,
      autoTopup: a.autoTopup,
      autoTopupAmountCents: a.autoTopupAmountCents,
      autoTopupThresholdCents: a.autoTopupThresholdCents,
      autoTopupMonthlyLimitCents: a.autoTopupMonthlyLimitCents,
      hasPaymentMethod: !!a.paymentMethodId,
      ledger: ledger.map((e) => ({
        id: e.id,
        kind: e.kind,
        description: e.description,
        amountMicros: e.amountMicros.toString(),
        createdAt: e.createdAt,
      })),
      rentals,
      rates: rates.map((r) => ({
        prefix: r.prefix,
        reservationUSDPerSegment:
          Number(r.maxProviderMicrosPerSegment * 2n) / 1e6,
        expiresAt: r.expiresAt,
      })),
    };
  });
}
export async function startCheckout(
  db: Database,
  env: Environment,
  p: Principal,
  body: unknown,
  key: string | undefined,
) {
  billingOwner(p);
  assert(
    key && /^[\w-]{8,100}$/.test(key),
    400,
    "idempotency_key_required",
    "Provide an Idempotency-Key",
  );
  const input = billingCheckoutInput.parse(body);
  const stripe = stripeClient(env);
  await ensureBilling(db, p.organizationId);
  const selection =
    input.kind === "plan"
      ? input.plan
      : input.kind === "topup"
        ? String(input.amountCents)
        : JSON.stringify({
            country: input.country,
            phoneNumber: input.phoneNumber,
          });
  const id = `${p.organizationId}:${key}`;
  if (
    input.kind === "phone" &&
    !(await db.billingCheckout.findUnique({ where: { id } }))
  ) {
    await selectedNumberQuote(env, input.country, input.phoneNumber);
  }
  const intent = await db.$transaction(
    async (tx) => {
      await billingLock(tx, p.organizationId);
      const prior = await tx.billingCheckout.findUnique({ where: { id } });
      if (prior) {
        assert(
          prior.organizationId === p.organizationId &&
            prior.kind === input.kind &&
            prior.selection === selection,
          409,
          "idempotency_conflict",
          "This key was already used",
        );
        return prior;
      }
      const account = await tx.billingAccount.findUniqueOrThrow({
        where: { organizationId: p.organizationId },
      });
      assert(
        !account.blocked,
        402,
        "billing_blocked",
        "Contact support to resolve your billing balance",
      );
      if (input.kind === "plan")
        assert(
          !account.stripeSubscriptionId,
          409,
          "subscription_exists",
          "Use Change plan or Manage subscription for your existing subscription",
        );
      if (input.kind === "phone") {
        assert(
          effectivePlan(account).numbers > 0,
          402,
          "subscription_required",
          "Choose a paid plan first",
        );
        const count = await tx.phoneRental.count({
          where: {
            organizationId: p.organizationId,
            status: { not: "canceled" },
          },
        });
        assert(
          count < effectivePlan(account).numbers,
          409,
          "quota_exceeded",
          "Phone rental limit reached",
        );
      }
      if (input.kind !== "topup") {
        const pending = await tx.billingCheckout.findFirst({
          where: {
            organizationId: p.organizationId,
            kind: input.kind,
            status: "pending",
          },
        });
        if (pending) {
          // A creation still in flight must finish before it can be superseded.
          if (!pending.stripeSessionId) {
            assert(
              pending.selection === selection,
              409,
              "checkout_pending",
              "Your previous checkout is still being created; try again shortly",
            );
            return pending;
          }
          let session = await stripe.checkout.sessions.retrieve(
            pending.stripeSessionId,
          );
          if (session.status === "open" && pending.selection === selection)
            return pending;
          // Stripe arbitrates races with payment completion. Never replace a
          // completed session, or proceed if expiry fails or is ambiguous.
          if (session.status === "open")
            session = await stripe.checkout.sessions.expire(session.id);
          assert(
            session.status === "expired",
            409,
            "checkout_pending",
            "Your previous checkout has completed; refresh billing while payment is processed",
          );
          await tx.billingCheckout.update({
            where: { id: pending.id },
            data: { status: "expired" },
          });
        }
      }
      return tx.billingCheckout.create({
        data: {
          id,
          organizationId: p.organizationId,
          kind: input.kind,
          selection,
          amountCents:
            input.kind === "topup"
              ? input.amountCents
              : input.kind === "phone"
                ? 300
                : plans[input.plan].monthlyCents,
        },
      });
    },
    { timeout: 45000 },
  );
  if (intent.stripeSessionId) {
    const session = await stripe.checkout.sessions.retrieve(
      intent.stripeSessionId,
    );
    assert(
      session.url && session.status === "open",
      409,
      "checkout_closed",
      "This checkout has completed or expired; refresh billing",
    );
    return { url: session.url };
  }
  let account = await db.billingAccount.findUniqueOrThrow({
    where: { organizationId: p.organizationId },
  });
  if (!account.stripeCustomerId) {
    const customer = await stripe.customers.create(
      { metadata: { papers_organization_id: p.organizationId } },
      { idempotencyKey: `papers-customer:${p.organizationId}` },
    );
    account = await db.billingAccount.update({
      where: { organizationId: p.organizationId },
      data: { stripeCustomerId: customer.id },
    });
  }
  const origin = env.BILLING_PUBLIC_ORIGIN;
  assert(
    origin && new URL(origin).protocol === "https:",
    503,
    "billing_unavailable",
    "Billing return URL is not configured",
  );
  const lookupKey =
    input.kind === "plan"
      ? `papers_${input.plan}_monthly_v1`
      : input.kind === "phone"
        ? "papers_us_number_monthly_v1"
        : `papers_topup_${input.amountCents}_v1`;
  const prices = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });
  assert(
    prices.data[0],
    503,
    "price_unavailable",
    "The billing catalog is not configured",
  );
  const metadata = {
    papers_checkout_id: intent.id,
    papers_organization_id: p.organizationId,
    papers_kind: input.kind,
  };
  const session = await stripe.checkout.sessions.create(
    {
      mode: input.kind === "topup" ? "payment" : "subscription",
      customer: account.stripeCustomerId!,
      client_reference_id: intent.id,
      line_items: [{ price: prices.data[0].id, quantity: 1 }],
      metadata,
      payment_method_types: ["card"],
      ...(input.kind === "topup"
        ? {
            payment_intent_data: {
              metadata,
              setup_future_usage: "off_session" as const,
            },
          }
        : { subscription_data: { metadata } }),
      ...(input.kind === "phone"
        ? {
            custom_text: {
              submit: {
                message: `Rent ${input.phoneNumber} for $3/month. SMS uses prepaid credit. We activate your number after payment. If it is no longer available, we cancel and refund this rental.`,
              },
            },
          }
        : {}),
      success_url: `${origin}/dashboard/${input.kind === "phone" ? "numbers" : "billing"}?checkout=success`,
      cancel_url: `${origin}/dashboard/${input.kind === "phone" ? "numbers" : "billing"}?checkout=canceled`,
    },
    { idempotencyKey: `papers-checkout:${intent.id}` },
  );
  await db.billingCheckout.update({
    where: { id: intent.id },
    data: { stripeSessionId: session.id },
  });
  return { url: session.url };
}
export async function billingPortal(
  db: Database,
  env: Environment,
  p: Principal,
) {
  billingOwner(p);
  const a = await db.billingAccount.findUnique({
    where: { organizationId: p.organizationId },
  });
  assert(
    a?.stripeCustomerId && env.BILLING_PUBLIC_ORIGIN,
    409,
    "customer_required",
    "Choose a plan first",
  );
  return {
    url: (
      await stripeClient(env).billingPortal.sessions.create({
        customer: a.stripeCustomerId,
        return_url: `${env.BILLING_PUBLIC_ORIGIN}/dashboard/billing`,
        ...(env.STRIPE_PORTAL_CONFIGURATION_ID
          ? { configuration: env.STRIPE_PORTAL_CONFIGURATION_ID }
          : {}),
      })
    ).url,
  };
}
export async function changePlan(
  db: Database,
  env: Environment,
  p: Principal,
  body: unknown,
) {
  billingOwner(p);
  const { plan } = changePlanInput.parse(body);
  const a = await db.billingAccount.findUniqueOrThrow({
    where: { organizationId: p.organizationId },
  });
  assert(
    a.stripeSubscriptionId,
    409,
    "subscription_required",
    "Subscribe first",
  );
  const stripe = stripeClient(env);
  const sub = await stripe.subscriptions.retrieve(a.stripeSubscriptionId);
  const price = (
    await stripe.prices.list({
      lookup_keys: [`papers_${plan}_monthly_v1`],
      active: true,
      limit: 1,
    })
  ).data[0];
  assert(
    price && sub.items.data.length === 1,
    409,
    "invalid_subscription",
    "Contact support to change this subscription",
  );
  assert(
    sub.status === "active" && !sub.pending_update,
    409,
    "payment_pending",
    "Resolve your pending subscription payment first",
  );
  const currentItem = sub.items.data[0]!;
  assert(
    price.id !== currentItem.price.id,
    409,
    "same_plan",
    "This plan is already active",
  );
  if (plans[plan].monthlyCents < effectivePlan(a).monthlyCents) {
    const schedule = sub.schedule
      ? await stripe.subscriptionSchedules.retrieve(
          typeof sub.schedule === "string" ? sub.schedule : sub.schedule.id,
        )
      : await stripe.subscriptionSchedules.create(
          { from_subscription: sub.id },
          {
            idempotencyKey: `papers-downgrade:${sub.id}:${currentItem.current_period_end}`,
          },
        );
    await stripe.subscriptionSchedules.update(schedule.id, {
      end_behavior: "release",
      phases: [
        {
          start_date: currentItem.current_period_start,
          end_date: currentItem.current_period_end,
          items: [{ price: currentItem.price.id, quantity: 1 }],
          proration_behavior: "none",
        },
        {
          start_date: currentItem.current_period_end,
          items: [{ price: price.id, quantity: 1 }],
          proration_behavior: "none",
        },
      ],
    });
    return { pending: false, scheduled: true };
  }
  if (sub.schedule)
    await stripe.subscriptionSchedules.release(
      typeof sub.schedule === "string" ? sub.schedule : sub.schedule.id,
    );
  const updated = await stripe.subscriptions.update(sub.id, {
    items: [{ id: sub.items.data[0]!.id, price: price.id }],
    payment_behavior: "pending_if_incomplete",
    proration_behavior: "always_invoice",
  });
  await syncSubscription(db, stripe, updated.id, env);
  return { pending: !!updated.pending_update };
}
export async function updateAutoTopup(
  db: Database,
  p: Principal,
  body: unknown,
) {
  billingOwner(p);
  const data = autoTopupInput.parse(body);
  assert(
    data.autoTopupMonthlyLimitCents >= data.autoTopupAmountCents,
    400,
    "invalid_limit",
    "Monthly limit must cover at least one top-up",
  );
  const a = await ensureBilling(db, p.organizationId);
  assert(
    !data.autoTopup || a.paymentMethodId,
    409,
    "payment_method_required",
    "Complete a manual top-up first to save a payment method",
  );
  await db.billingAccount.update({
    where: { organizationId: p.organizationId },
    data,
  });
  return { saved: true };
}
export async function ingestStripe(
  db: Database,
  env: Environment,
  request: Request,
) {
  assert(
    env.STRIPE_WEBHOOK_SECRET,
    503,
    "billing_unavailable",
    "Stripe webhook is not configured",
  );
  const raw = await request.text();
  assert(
    raw.length < 1000000,
    413,
    "payload_too_large",
    "Webhook is too large",
  );
  let event: Stripe.Event;
  try {
    event = await stripeClient(env).webhooks.constructEventAsync(
      raw,
      request.headers.get("stripe-signature") ?? "",
      env.STRIPE_WEBHOOK_SECRET,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    throw new AppError(400, "invalid_signature", "Invalid Stripe signature");
  }
  assert(
    event.livemode === env.STRIPE_SECRET_KEY?.startsWith("sk_live_"),
    400,
    "stripe_mode_mismatch",
    "Unexpected Stripe mode",
  );
  await db.providerEvent.upsert({
    where: { id: `stripe:${event.id}` },
    create: {
      id: `stripe:${event.id}`,
      provider: "stripe",
      type: event.type,
      payload: JSON.parse(raw) as Prisma.InputJsonValue,
    },
    update: {},
  });
  return { received: true };
}
async function syncSubscription(
  db: Database,
  stripe: Stripe,
  id: string,
  env: Environment,
) {
  const sub = await stripe.subscriptions.retrieve(id, {
    expand: ["latest_invoice"],
  });
  const org = sub.metadata.papers_organization_id;
  if (!org) return;
  const a = await db.billingAccount.findUnique({
    where: { organizationId: org },
  });
  if (
    !a ||
    a.stripeCustomerId !==
      (typeof sub.customer === "string" ? sub.customer : sub.customer.id)
  )
    return;
  const item = sub.items.data[0];
  const paid =
    sub.status === "active" &&
    typeof sub.latest_invoice === "object" &&
    sub.latest_invoice?.status === "paid";
  if (sub.metadata.papers_kind === "phone") {
    const intent = sub.metadata.papers_checkout_id
      ? await db.billingCheckout.findUnique({
          where: { id: sub.metadata.papers_checkout_id },
        })
      : null;
    if (intent && ["refund_pending", "refunded"].includes(intent.status)) {
      await refundFailedPhoneCheckout(db, stripe, id);
      return;
    }
    const welcomeEligible =
      paid &&
      item &&
      sub.latest_invoice &&
      typeof sub.latest_invoice === "object" &&
      sub.latest_invoice.amount_paid > 0 &&
      (await stripe.prices.retrieve(item.price.id)).lookup_key ===
        "papers_us_number_monthly_v1";
    await db.$transaction(async (tx) => {
      await billingLock(tx, org);
      await tx.phoneRental.upsert({
        where: { id },
        create: {
          id,
          organizationId: org,
          status: paid ? "active" : sub.status,
          paidUntil:
            paid && item ? new Date(item.current_period_end * 1000) : null,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        },
        update: {
          status: paid ? "active" : sub.status,
          ...(paid && item
            ? { paidUntil: new Date(item.current_period_end * 1000) }
            : {}),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        },
      });
    });
    if (paid && sub.metadata.papers_checkout_id) {
      const fulfilled = await fulfillPhoneCheckout(db, env, stripe, sub);
      if (!fulfilled) return;
    }
    await db.$transaction(async (tx) => {
      await billingLock(tx, org);
      if (welcomeEligible) {
        await ledgerEntry(tx, {
          organizationId: org,
          key: `phone-welcome:${org}`,
          kind: "phone_welcome",
          amountMicros: USD / 2n,
          description: "One-time $0.50 credit for your first paid phone rental",
          resourceId: id,
        });
      }
    });
    return;
  }
  if (sub.metadata.papers_kind !== "plan" || !item) return;
  const price = await stripe.prices.retrieve(item.price.id);
  const plan =
    price.lookup_key === "papers_developer_monthly_v1"
      ? "developer"
      : price.lookup_key === "papers_scale_monthly_v1"
        ? "scale"
        : null;
  if (!plan) throw new Error("Unrecognized Papers plan price");
  await db.$transaction(async (tx) => {
    await billingLock(tx, org);
    const current = await tx.billingAccount.findUniqueOrThrow({
      where: { organizationId: org },
    });
    if (current.stripeSubscriptionId && current.stripeSubscriptionId !== id) {
      if (sub.status === "canceled") return;
      throw new Error("Duplicate workspace subscription");
    }
    await tx.billingAccount.update({
      where: { organizationId: org },
      data: {
        stripeSubscriptionId: sub.status === "canceled" ? null : id,
        status: paid ? "active" : sub.status,
        ...(paid
          ? {
              plan,
              periodStart: new Date(item.current_period_start * 1000),
              periodEnd: new Date(item.current_period_end * 1000),
            }
          : {}),
      },
    });
  });
}
export async function creditPayment(
  db: Database,
  stripe: Stripe,
  paymentId: string,
) {
  const pi = await stripe.paymentIntents.retrieve(paymentId);
  if (pi.status !== "succeeded") return;
  const id = pi.metadata.papers_checkout_id;
  if (!id) return;
  await db.$transaction(async (tx) => {
    const intent = await tx.billingCheckout.findUnique({ where: { id } });
    if (!intent || !["topup", "auto_topup"].includes(intent.kind)) return;
    await billingLock(tx, intent.organizationId);
    const a = await tx.billingAccount.findUniqueOrThrow({
      where: { organizationId: intent.organizationId },
    });
    assert(
      pi.customer === a.stripeCustomerId &&
        pi.currency === "usd" &&
        pi.amount_received === intent.amountCents,
      400,
      "payment_mismatch",
      "Payment does not match this credit purchase",
    );
    await ledgerEntry(tx, {
      organizationId: intent.organizationId,
      key: `payment:${pi.id}`,
      kind: "topup",
      amountMicros: BigInt(pi.amount_received) * 10000n,
      description: "Prepaid usage top-up",
      resourceId: pi.id,
    });
    await tx.billingCheckout.update({
      where: { id },
      data: { status: "paid", paymentIntentId: pi.id },
    });
    if (typeof pi.payment_method === "string")
      await tx.billingAccount.update({
        where: { organizationId: intent.organizationId },
        data: { paymentMethodId: pi.payment_method },
      });
  });
}
export async function processStripeEvents(db: Database, env: Environment) {
  if (!env.STRIPE_SECRET_KEY) return { processed: 0 };
  const stripe = stripeClient(env);
  const rows = await db.providerEvent.findMany({
    where: {
      provider: "stripe",
      status: "pending",
      availableAt: { lte: new Date() },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  for (const row of rows) {
    const claim = await db.providerEvent.updateMany({
      where: {
        id: row.id,
        status: "pending",
        availableAt: { lte: new Date() },
      },
      data: {
        availableAt: new Date(Date.now() + 60000),
        attempts: { increment: 1 },
      },
    });
    if (!claim.count) continue;
    try {
      const event = row.payload as unknown as Stripe.Event;
      if (event.type === "payment_intent.succeeded")
        await creditPayment(db, stripe, event.data.object.id);
      else if (
        event.type === "checkout.session.completed" ||
        event.type === "checkout.session.async_payment_succeeded"
      ) {
        const session = event.data.object;
        if (typeof session.payment_intent === "string")
          await creditPayment(db, stripe, session.payment_intent);
        if (typeof session.subscription === "string")
          await syncSubscription(db, stripe, session.subscription, env);
        if (session.client_reference_id)
          await db.billingCheckout.updateMany({
            where: {
              id: session.client_reference_id,
              stripeSessionId: session.id,
            },
            data: {
              status: session.payment_status === "paid" ? "paid" : "pending",
            },
          });
      } else if (event.type === "checkout.session.expired") {
        await db.billingCheckout.updateMany({
          where: { stripeSessionId: event.data.object.id, status: "pending" },
          data: { status: "expired" },
        });
      } else if (event.type.startsWith("customer.subscription."))
        await syncSubscription(
          db,
          stripe,
          (event.data.object as Stripe.Subscription).id,
          env,
        );
      else if (event.type.startsWith("invoice.")) {
        const invoice = event.data.object as Stripe.Invoice;
        const sub = invoice.parent?.subscription_details?.subscription;
        if (typeof sub === "string")
          await syncSubscription(db, stripe, sub, env);
      } else if (
        event.type === "charge.refunded" ||
        event.type === "charge.dispute.created"
      ) {
        const obj = event.data.object;
        const charge =
          event.type === "charge.refunded"
            ? (obj as Stripe.Charge)
            : await stripe.charges.retrieve(
                (obj as Stripe.Dispute).charge as string,
              );
        if (
          event.type === "charge.refunded" &&
          typeof charge.payment_intent === "string" &&
          (await db.billingCheckout.findFirst({
            where: {
              paymentIntentId: charge.payment_intent,
              kind: "phone",
              status: { in: ["refund_pending", "refunded"] },
            },
          }))
        ) {
          await db.providerEvent.update({
            where: { id: row.id },
            data: { status: "completed" },
          });
          continue;
        }
        const a =
          typeof charge.customer === "string"
            ? await db.billingAccount.findUnique({
                where: { stripeCustomerId: charge.customer },
              })
            : null;
        if (a)
          await db.$transaction(async (tx) => {
            await billingLock(tx, a.organizationId);
            await tx.billingAccount.update({
              where: { organizationId: a.organizationId },
              data: { blocked: true, autoTopup: false },
            });
            // Freeze all spending until reconciled. Refund events never grant new credit.
          });
      }
      await db.providerEvent.update({
        where: { id: row.id },
        data: {
          status: "completed",
          payload: { stripe_event_id: event.id },
          error: null,
        },
      });
    } catch {
      await db.providerEvent.update({
        where: { id: row.id },
        data: {
          status: row.attempts >= 15 ? "dead_letter" : "pending",
          error: "stripe_processing_failed",
          availableAt: new Date(
            Date.now() + Math.min(3600000, 2 ** row.attempts * 1000),
          ),
        },
      });
    }
  }
  return { processed: rows.length };
}
export async function autoTopups(db: Database, env: Environment) {
  if (!env.STRIPE_SECRET_KEY) return { processed: 0 };
  const stripe = stripeClient(env);
  const accounts = await db.billingAccount.findMany({
    where: { autoTopup: true, blocked: false, paymentMethodId: { not: null } },
    take: 100,
  });
  let processed = 0;
  for (const a of accounts) {
    const intent = await db.$transaction(async (tx) => {
      await billingLock(tx, a.organizationId);
      const current = await tx.billingAccount.findUniqueOrThrow({
        where: { organizationId: a.organizationId },
      });
      if (
        !current.autoTopup ||
        current.blocked ||
        effectivePlan(current).monthlyCents === 0
      )
        return null;
      const pending = await tx.billingCheckout.findFirst({
        where: {
          organizationId: a.organizationId,
          kind: "auto_topup",
          status: "pending",
        },
      });
      if (pending) return pending;
      if (
        current.balanceMicros - current.reservedMicros >=
        BigInt(current.autoTopupThresholdCents) * 10000n
      )
        return null;
      const monthStart = new Date(
        new Date().toISOString().slice(0, 7) + "-01T00:00:00Z",
      );
      const spent = await tx.billingCheckout.aggregate({
        where: {
          organizationId: a.organizationId,
          kind: "auto_topup",
          status: { in: ["pending", "paid"] },
          createdAt: { gte: monthStart },
        },
        _sum: { amountCents: true },
      });
      if (
        (spent._sum.amountCents ?? 0) + current.autoTopupAmountCents >
        current.autoTopupMonthlyLimitCents
      )
        return null;
      return tx.billingCheckout.create({
        data: {
          organizationId: a.organizationId,
          kind: "auto_topup",
          selection: String(current.autoTopupAmountCents),
          amountCents: current.autoTopupAmountCents,
        },
      });
    });
    if (!intent) continue;
    // Never replay a create after Stripe's idempotency retention window; reconcile manually instead.
    if (
      !intent.paymentIntentId &&
      Date.now() - intent.createdAt.getTime() > 23 * 3600000
    )
      continue;
    try {
      const pi = intent.paymentIntentId
        ? await stripe.paymentIntents.retrieve(intent.paymentIntentId)
        : await stripe.paymentIntents.create(
            {
              amount: intent.amountCents,
              currency: "usd",
              customer: a.stripeCustomerId!,
              payment_method: a.paymentMethodId!,
              off_session: true,
              confirm: true,
              metadata: {
                papers_checkout_id: intent.id,
                papers_organization_id: a.organizationId,
              },
            },
            { idempotencyKey: `papers-auto:${intent.id}` },
          );
      await db.billingCheckout.update({
        where: { id: intent.id },
        data: { paymentIntentId: pi.id },
      });
      if (pi.status === "succeeded") await creditPayment(db, stripe, pi.id);
      else if (
        ["requires_action", "requires_payment_method", "canceled"].includes(
          pi.status,
        )
      ) {
        await db.billingCheckout.update({
          where: { id: intent.id },
          data: { status: "failed" },
        });
        await db.billingAccount.update({
          where: { organizationId: a.organizationId },
          data: { autoTopup: false },
        });
      }
      processed++;
    } catch (e) {
      if (e instanceof Stripe.errors.StripeCardError) {
        await db.billingCheckout.update({
          where: { id: intent.id },
          data: { status: "failed" },
        });
        await db.billingAccount.update({
          where: { organizationId: a.organizationId },
          data: { autoTopup: false },
        });
      }
      // Network errors retain the durable pending attempt and its idempotency key.
    }
  }
  return { processed };
}

/** Cancel/refund only a selected-number purchase whose provisioning definitively failed. */
export async function refundFailedPhoneCheckout(
  db: Database,
  stripe: Stripe,
  subscriptionId: string,
) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["latest_invoice"],
  });
  const checkout = await db.billingCheckout.findUnique({
    where: { id: sub.metadata.papers_checkout_id ?? "" },
  });
  if (
    !checkout ||
    checkout.kind !== "phone" ||
    !checkout.selection.startsWith("{")
  )
    return false;
  if (checkout.status === "refunded") return true;
  const invoice = sub.latest_invoice;
  assert(
    invoice && typeof invoice === "object",
    503,
    "refund_pending",
    "Rental refund is being processed",
  );
  await db.billingCheckout.update({
    where: { id: checkout.id },
    data: { status: "refund_pending" },
  });
  if (sub.status !== "canceled")
    await stripe.subscriptions.cancel(sub.id, {
      prorate: false,
      invoice_now: false,
    });
  const payments = await stripe.invoicePayments.list({
    invoice: invoice.id,
    status: "paid",
    limit: 100,
  });
  for (const payment of payments.data) {
    const pi = payment.payment.payment_intent;
    assert(
      pi && payment.amount_paid !== null && payment.amount_paid > 0,
      503,
      "refund_pending",
      "Rental refund requires payment reconciliation",
    );
    const paymentId = typeof pi === "string" ? pi : pi.id;
    const existing = await stripe.refunds.list({
      payment_intent: paymentId,
      limit: 100,
    });
    const refund = existing.data.find(
      (r) => r.metadata?.papers_failed_phone === checkout.id,
    );
    if (refund?.status === "failed" || refund?.status === "canceled")
      throw new Error("Phone refund requires reconciliation");
    await db.billingCheckout.update({
      where: { id: checkout.id },
      data: { paymentIntentId: paymentId },
    });
    if (!refund)
      await stripe.refunds.create(
        {
          payment_intent: paymentId,
          amount: payment.amount_paid,
          metadata: { papers_failed_phone: checkout.id },
        },
        { idempotencyKey: `phone-refund:${checkout.id}:${payment.id}` },
      );
  }
  if (invoice.amount_paid > 0 && !payments.data.length)
    throw new Error("Phone invoice payment not yet available");
  await db.phoneRental.update({
    where: { id: sub.id },
    data: { status: "canceled", cancelAtPeriodEnd: false },
  });
  await db.billingCheckout.update({
    where: { id: checkout.id },
    data: { status: "refunded" },
  });
  return true;
}

async function fulfillPhoneCheckout(
  db: Database,
  env: Environment,
  stripe: Stripe,
  sub: Stripe.Subscription,
) {
  const checkout = await db.billingCheckout.findUnique({
    where: { id: sub.metadata.papers_checkout_id! },
  });
  if (
    !checkout ||
    checkout.kind !== "phone" ||
    !checkout.selection.startsWith("{")
  )
    return true; // Existing unassigned rentals.
  if (["refund_pending", "refunded"].includes(checkout.status)) {
    await refundFailedPhoneCheckout(db, stripe, sub.id);
    return false;
  }
  const rental = await db.phoneRental.findUniqueOrThrow({
    where: { id: sub.id },
  });
  if (rental.phoneNumberId) {
    const number = await db.phoneNumber.findUniqueOrThrow({
      where: { id: rental.phoneNumberId },
    });
    if (number.status === "failed") {
      await refundFailedPhoneCheckout(db, stripe, sub.id);
      return false;
    }
    return true; // Pending or ambiguous provider outcomes must never be reordered/refunded.
  }
  const selection = billingCheckoutInput.parse({
    kind: "phone",
    ...JSON.parse(checkout.selection),
  });
  if (selection.kind !== "phone") throw new Error("Invalid phone selection");
  try {
    const quote = await selectedNumberQuote(
      env,
      selection.country,
      selection.phoneNumber,
    );
    const result = await provisionNumber(
      db,
      { ...env, BILLING_ENABLED: "true" },
      {
        id: `phone-checkout:${checkout.id}`,
        userId: "billing-system",
        organizationId: checkout.organizationId,
        role: "owner",
        scopes: ["numbers:provision"],
        credential: { kind: "session", id: checkout.id },
      },
      quote,
      `paid-phone:${checkout.id}`,
      sub.id,
    );
    if (result.body.status === "failed") {
      await refundFailedPhoneCheckout(db, stripe, sub.id);
      return false;
    }
    return true;
  } catch (error) {
    if (
      error instanceof AppError &&
      [
        "number_unavailable",
        "quote_required",
        "quota_exceeded",
        "subscription_required",
      ].includes(error.code)
    ) {
      await refundFailedPhoneCheckout(db, stripe, sub.id);
      return false;
    }
    throw error;
  }
}
