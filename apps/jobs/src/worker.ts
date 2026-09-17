import {
  cloudflareWebhookTransport,
  cloudflareMediaTransport,
} from "../../../packages/core/src/webhook-transport-cloudflare";
import type { ExportedHandler } from "@cloudflare/workers-types";
import { createDatabase } from "@agentinfra/db/edge";
import { runBackgroundJobs } from "../../../packages/core/src/background-jobs";

async function runCycle(env: JobsEnv) {
  const db = createDatabase(env.HYPERDRIVE.connectionString);
  try {
    const cycle = await runBackgroundJobs(
      db,
      {
        CUSTOM_WEBHOOK_ENCRYPTION_KEY: env.CUSTOM_WEBHOOK_ENCRYPTION_KEY,
        STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
        BILLING_ENABLED: env.BILLING_ENABLED,
        RESEND_API_KEY: env.RESEND_API_KEY,
        TELNYX_API_KEY: env.TELNYX_API_KEY,
        TELNYX_PUBLIC_KEY: env.TELNYX_PUBLIC_KEY,
        TELNYX_MESSAGING_PROFILE_ID: env.TELNYX_MESSAGING_PROFILE_ID,
        TELNYX_STATUS: env.TELNYX_STATUS,
        ATTACHMENTS: {
          put: (key, value, options) =>
            env.ATTACHMENTS.put(key, value, options),
        },
      },
      {
        mediaTransport:
          String(env.WEBHOOK_TRANSPORT) === "cloudflare"
            ? cloudflareMediaTransport(fetch)
            : undefined,
        webhookTransport:
          String(env.WEBHOOK_TRANSPORT) === "cloudflare"
            ? cloudflareWebhookTransport(fetch)
            : undefined,
      },
    );
    console.log(JSON.stringify({ event: "background_cycle", ...cycle }));
    if (cycle.failed.length) throw new Error("Background job lanes failed");
  } finally {
    await db.$disconnect();
  }
}

export default {
  async scheduled(_controller, env) {
    await runCycle(env);
  },
  async queue(_batch, env) {
    // Notifications contain no authoritative work. Successful return acknowledges
    // the batch; throwing retries it. Core rows retain their own retry schedules.
    await runCycle(env);
  },
} satisfies ExportedHandler<JobsEnv>;
