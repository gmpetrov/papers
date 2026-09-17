import { createRequire } from "node:module";
import { readFile, writeFile, chmod } from "node:fs/promises";
const require = createRequire(
  new URL("../packages/core/package.json", import.meta.url),
);
const Stripe = require("stripe");
const testMode = process.argv.includes("--test");
const envFile = testMode ? ".env" : ".env.stripe.production";
process.loadEnvFile(envFile);
if (
  !process.env.STRIPE_SECRET_KEY?.startsWith(testMode ? "sk_test_" : "sk_live_")
)
  throw new Error("stripe_key_mode_mismatch");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const expected = "acct_1TglYsRbMiIVQuK6";
try {
  const account = await stripe.accounts.retrieve();
  if (account.id !== expected) throw new Error("account_mismatch");
  const products = [
    [
      "papers_developer_v1",
      "Papers Developer",
      "10 inboxes, 10,000 emails/month, 10 GB storage, 2 members. Custom domains coming soon.",
    ],
    [
      "papers_scale_v1",
      "Papers Scale",
      "150 inboxes, 100,000 emails/month, 100 GB storage, 10 members. Custom domains coming soon.",
    ],
    [
      "papers_phone_v1",
      "Papers US phone number",
      "Standard US phone rental. Messaging is prepaid separately.",
    ],
    [
      "papers_usage_v1",
      "Papers prepaid usage",
      "Credit for Papers communications only. Unused credit carries forward.",
    ],
    [
      "papers_inbox_v1",
      "Papers additional inbox",
      "One additional active inbox.",
    ],
    [
      "papers_domain_v1",
      "Papers additional custom domain",
      "Reserved catalog entry; not available until custom domains launch.",
    ],
    [
      "papers_email_v1",
      "Papers additional emails",
      "Additional email usage at $2 per 1,000 recipient emails.",
    ],
  ];
  for (const [id, name, description] of products) {
    try {
      await stripe.products.retrieve(id);
    } catch (e) {
      if (e.code !== "resource_missing") throw e;
      await stripe.products.create(
        { id, name, description, metadata: { papers_catalog: "v1" } },
        { idempotencyKey: `setup:${id}` },
      );
    }
  }
  const definitions = [
    ["papers_developer_monthly_v1", "papers_developer_v1", 2000, true],
    ["papers_scale_monthly_v1", "papers_scale_v1", 20000, true],
    ["papers_us_number_monthly_v1", "papers_phone_v1", 300, true],
    ["papers_extra_inbox_monthly_v1", "papers_inbox_v1", 200, true],
    ["papers_extra_domain_monthly_v1", "papers_domain_v1", 200, true],
    ["papers_extra_email_1000_v1", "papers_email_v1", 200, false],
    ...[1000, 2500, 5000, 10000].map((c) => [
      `papers_topup_${c}_v1`,
      "papers_usage_v1",
      c,
      false,
    ]),
  ];
  const catalog = {};
  for (const [key, product, amount, recurring] of definitions) {
    let price = (await stripe.prices.list({ lookup_keys: [key], limit: 1 }))
      .data[0];
    if (!price)
      price = await stripe.prices.create(
        {
          product,
          currency: "usd",
          unit_amount: amount,
          lookup_key: key,
          ...(recurring ? { recurring: { interval: "month" } } : {}),
        },
        { idempotencyKey: `setup:${key}` },
      );
    if (
      price.unit_amount !== amount ||
      price.currency !== "usd" ||
      price.product !== product ||
      !price.active
    )
      throw new Error("price_mismatch");
    catalog[key] = price.id;
  }
  let portal = (
    await stripe.billingPortal.configurations.list({ limit: 100 })
  ).data.find((x) => x.metadata?.papers_catalog === "v1");
  if (!portal)
    portal = await stripe.billingPortal.configurations.create(
      {
        metadata: { papers_catalog: "v1" },
        business_profile: { headline: "Manage your Papers subscription" },
        features: {
          invoice_history: { enabled: true },
          payment_method_update: { enabled: true },
          subscription_cancel: { enabled: true, mode: "at_period_end" },
          customer_update: {
            enabled: true,
            allowed_updates: ["email", "address", "tax_id"],
          },
          subscription_update: { enabled: false },
        },
      },
      { idempotencyKey: "setup:papers-portal-v1" },
    );
  const url = testMode
    ? new URL("/api/webhooks/stripe", process.env.NEXT_PUBLIC_APP_URL).href
    : "https://www.papers.bot/api/webhooks/stripe";
  if (!url.startsWith("https://"))
    throw new Error("public_https_webhook_required");
  let webhook = (await stripe.webhookEndpoints.list({ limit: 100 })).data.find(
    (x) => x.url === url && x.status === "enabled",
  );
  let secret;
  const events = [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.expired",
    "payment_intent.succeeded",
    "invoice.paid",
    "invoice.payment_failed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "charge.refunded",
    "charge.dispute.created",
  ];
  if (!webhook) {
    webhook = await stripe.webhookEndpoints.create(
      {
        url,
        api_version: Stripe.API_VERSION,
        enabled_events: events,
        description: `Papers ${testMode ? "sandbox" : "production"} billing v1`,
      },
      { idempotencyKey: `setup:papers-webhook-v1:${url}` },
    );
    secret = webhook.secret;
  } else
    await stripe.webhookEndpoints.update(webhook.id, {
      enabled_events: events,
    });
  let text = await readFile(envFile, "utf8");
  const set = (key, value) => {
    const pattern = new RegExp(`^${key}=.*$`, "m");
    text = pattern.test(text)
      ? text.replace(pattern, `${key}=${value}`)
      : `${text.trimEnd()}\n${key}=${value}\n`;
  };
  set("STRIPE_PORTAL_CONFIGURATION_ID", portal.id);
  if (secret) set("STRIPE_WEBHOOK_SECRET", secret);
  await writeFile(envFile, text, { mode: 0o600 });
  await chmod(envFile, 0o600);
  console.log(
    JSON.stringify(
      {
        account: account.id,
        live: !testMode,
        catalog,
        portal: portal.id,
        webhook: webhook.id,
        webhookSecretSaved: !!secret || text.includes("STRIPE_WEBHOOK_SECRET="),
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error(JSON.stringify({ error: e.code || e.type || e.message }));
  process.exitCode = 1;
}
