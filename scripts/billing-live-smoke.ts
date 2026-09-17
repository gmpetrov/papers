/** Explicit opt-in: creates and expires unpaid Checkout sessions. Never submits payment. */
import { createDatabase } from "../packages/db/src/index";
import {
  startCheckout,
  stripeClient,
} from "../packages/core/src/stripe-billing";
import type { Principal } from "../packages/core/src/principal";
if (!process.argv.includes("--create-unpaid-checkout"))
  throw new Error("Pass --create-unpaid-checkout explicitly");
const env = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  BILLING_PUBLIC_ORIGIN:
    process.env.BETTER_AUTH_URL || "https://www.papers.bot",
};
const stripe = stripeClient(env);
const account = await stripe.accounts.retrieve();
if (account.id !== "acct_1TglYsRbMiIVQuK6")
  throw new Error("Unexpected Stripe account");
const db = createDatabase(process.env.DATABASE_URL!);
const id = `billing-smoke-${crypto.randomUUID()}`;
const sessions: string[] = [];
try {
  await db.organization.create({
    data: {
      id,
      name: "Papers unpaid billing verification",
      slug: id,
      createdAt: new Date(),
    },
  });
  const p: Principal = {
    id,
    userId: id,
    organizationId: id,
    role: "owner",
    scopes: [],
    credential: { kind: "session", id },
  };
  const key = crypto.randomUUID();
  const result = await startCheckout(
    db,
    env,
    p,
    { kind: "topup", amountCents: 1000 },
    key,
  );
  const replay = await startCheckout(
    db,
    env,
    p,
    { kind: "topup", amountCents: 1000 },
    key,
  );
  if (!result.url || result.url !== replay.url)
    throw new Error("Checkout idempotency failed");
  await startCheckout(
    db,
    env,
    p,
    { kind: "plan", plan: "scale" },
    crypto.randomUUID(),
  );
  const replacement = await startCheckout(
    db,
    env,
    p,
    { kind: "plan", plan: "developer" },
    crypto.randomUUID(),
  );
  const reused = await startCheckout(
    db,
    env,
    p,
    { kind: "plan", plan: "developer" },
    crypto.randomUUID(),
  );
  if (replacement.url !== reused.url)
    throw new Error("Open plan checkout was not reused");
  const checkouts = await db.billingCheckout.findMany({
    where: { organizationId: id },
  });
  for (const c of checkouts) {
    if (!c.stripeSessionId) throw new Error("Missing Checkout session");
    sessions.push(c.stripeSessionId);
    const session = await stripe.checkout.sessions.retrieve(c.stripeSessionId);
    if (
      session.amount_total !== c.amountCents ||
      session.currency !== "usd" ||
      session.payment_status !== "unpaid"
    )
      throw new Error("Unexpected Checkout price or payment state");
    if (c.selection === "scale" && session.status !== "expired")
      throw new Error("Abandoned Scale checkout was not expired");
    if (session.status === "open")
      await stripe.checkout.sessions.expire(session.id);
  }
  const b = await db.billingAccount.findUniqueOrThrow({
    where: { organizationId: id },
  });
  if (b.balanceMicros !== 0n || b.status !== "free")
    throw new Error("Unpaid checkout granted an entitlement");
  console.log(
    JSON.stringify({
      account: account.id,
      unpaidCheckoutSessions: sessions.length,
      idempotencyVerified: true,
      abandonedPlanSwitchVerified: true,
      grantedCredit: 0,
      expired: true,
    }),
  );
} finally {
  const b = await db.billingAccount.findUnique({
    where: { organizationId: id },
  });
  const rows = await db.billingCheckout.findMany({
    where: { organizationId: id },
  });
  for (const row of rows)
    if (row.stripeSessionId) {
      const s = await stripe.checkout.sessions.retrieve(row.stripeSessionId);
      if (s.status === "open") await stripe.checkout.sessions.expire(s.id);
    }
  if (b?.stripeCustomerId) await stripe.customers.del(b.stripeCustomerId);
  await db.organization.deleteMany({ where: { id } });
  await db.$disconnect();
}
