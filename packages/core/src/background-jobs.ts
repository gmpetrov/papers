import { reconcileBillingPhones } from "./billing-phones";
import { processStripeEvents, autoTopups } from "./stripe-billing";
import { pruneRequestBuckets } from "./request-limits";
import { reconcileSmsOptOuts } from "./sms-opt-out-sync";
import {
  processWebhookDeliveries,
  type WebhookTransport,
} from "./webhook-delivery";
import type { Database } from "@agentinfra/db";
import type { Environment } from "./index";
import { processProviderEvents } from "./webhooks";
import { processTelnyxEvents } from "./telnyx-webhooks";
import { reconcilePhoneNumbers } from "./phone-numbers";
import { reconcileSmsSends } from "./sms-reconciliation";
import {
  processAttachments,
  type AttachmentBucket,
  type MediaTransport,
} from "./attachments";

/** Each lane keeps its own durable claims; one failed lane must not starve the rest. */
export async function runBackgroundJobs(
  db: Database,
  env: Omit<Environment, "ATTACHMENTS"> & {
    ATTACHMENTS?: Pick<AttachmentBucket, "put">;
  },
  options: {
    webhookTransport?: WebhookTransport;
    mediaTransport?: MediaTransport;
  } = {},
) {
  const { ATTACHMENTS, ...providers } = env;
  const jobs = [
    ["stripe", () => processStripeEvents(db, providers)],
    ["auto_topups", () => autoTopups(db, providers)],
    ["billing_phones", () => reconcileBillingPhones(db, providers)],
    ["request_limits", () => pruneRequestBuckets(db)],
    ["resend", () => processProviderEvents(db, providers)],
    ["telnyx", () => processTelnyxEvents(db)],
    [
      "attachments",
      () => processAttachments(db, env, 10, options.mediaTransport),
    ],
    ["phone_numbers", () => reconcilePhoneNumbers(db, providers)],
    ["sms", () => reconcileSmsSends(db)],
    ["sms_opt_outs", () => reconcileSmsOptOuts(db, providers)],
  ] as const;
  const customerWebhooks = options.webhookTransport;
  const allJobs = customerWebhooks
    ? [
        ...jobs,
        [
          "customer_webhooks",
          () =>
            processWebhookDeliveries(
              db,
              env.CUSTOM_WEBHOOK_ENCRYPTION_KEY,
              customerWebhooks,
            ),
        ] as const,
      ]
    : jobs;
  const results: Record<
    string,
    { processed?: number; confirmed?: number; stored?: number }
  > = {};
  const failed: string[] = [];
  for (const [name, run] of allJobs) {
    try {
      results[name] = await run();
    } catch {
      failed.push(name);
    }
  }
  return { results, failed };
}
