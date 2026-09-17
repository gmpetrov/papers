import { createDatabase } from "../packages/db/src/index";
import { stripeClient } from "../packages/core/src/stripe-billing";
const development = process.argv.includes("--development");
const origin = development
  ? process.env.BETTER_AUTH_URL!
  : "https://www.papers.bot";
if (
  !process.env.STRIPE_SECRET_KEY?.startsWith(
    development ? "sk_test_" : "sk_live_",
  )
)
  throw new Error("Stripe key mode does not match verification target");
const env = { STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY };
const stripe = stripeClient(env);
const db = createDatabase(process.env.DATABASE_URL!);
const id = `evt_papers_verification_${crypto.randomUUID().replaceAll("-", "")}`;
try {
  const pricing = await fetch(`${origin}/pricing`);
  const html = await pricing.text();
  if (
    pricing.status !== 200 ||
    !html.includes("100,000") ||
    !html.includes("Choose Developer")
  )
    throw new Error("Pricing verification failed");
  const denied = await fetch(`${origin}/v1/billing`);
  if (denied.status !== 401)
    throw new Error("Billing authentication check failed");
  const unsigned = await fetch(`${origin}/api/webhooks/stripe`, {
    method: "POST",
    body: "{}",
  });
  if (unsigned.status !== 400)
    throw new Error("Unsigned webhook was not rejected");
  // A signed no-op verification event exercises ingress, durable storage and jobs.
  // It cannot grant credit or create a subscription.
  const body = JSON.stringify({
    id,
    object: "event",
    type: "papers.verification",
    livemode: !development,
    data: { object: { id: "verification" } },
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  });
  const response = await fetch(`${origin}/api/webhooks/stripe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": signature,
    },
    body,
  });
  if (response.status !== 200)
    throw new Error(`Signed webhook returned ${response.status}`);
  let status = "pending";
  for (let i = 0; i < 10; i++) {
    const event = await db.providerEvent.findUnique({
      where: { id: `stripe:${id}` },
    });
    status = event?.status ?? "missing";
    if (status === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  if (status !== "completed") throw new Error(`Jobs verification: ${status}`);
  console.log(
    JSON.stringify({
      pricing: 200,
      billingUnauthenticated: 401,
      unsignedWebhook: 400,
      signedWebhook: 200,
      backgroundProcessing: status,
      eventId: id,
    }),
  );
} finally {
  await db.$disconnect();
}
