import { cloudflareWebhookTransport } from "../../../packages/core/src/webhook-transport-cloudflare";
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
        RESEND_API_KEY: env.RESEND_API_KEY,
        TELNYX_API_KEY: env.TELNYX_API_KEY,
        TELNYX_STATUS: env.TELNYX_STATUS,
        ATTACHMENTS: {
          put: (key, value, options) =>
            env.ATTACHMENTS.put(key, value, options),
        },
      },
      {
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
