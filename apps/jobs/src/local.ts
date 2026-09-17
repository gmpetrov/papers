import { nodeWebhookTransport } from "../../../packages/core/src/webhook-transport-node";
import { runBackgroundJobs } from "../../../packages/core/src/background-jobs";
import { createDatabase } from "../../../packages/db/src/index";
import type { AttachmentBucket } from "../../../packages/core/src/attachments";
import { getPlatformProxy } from "wrangler";
import { fileURLToPath } from "node:url";
const platform = await getPlatformProxy<{ ATTACHMENTS: AttachmentBucket }>({
  configPath: fileURLToPath(
    new URL("../../web/wrangler.jsonc", import.meta.url),
  ),
  persist: {
    path: fileURLToPath(new URL("../../../.wrangler/shared", import.meta.url)),
  },
});
const db = createDatabase(process.env.DATABASE_URL!);
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
console.log("Papers webhook worker started");
while (!stopping) {
  try {
    const cycle = await runBackgroundJobs(
      db,
      {
        CUSTOM_WEBHOOK_ENCRYPTION_KEY:
          process.env.CUSTOM_WEBHOOK_ENCRYPTION_KEY,
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
        BILLING_ENABLED: process.env.BILLING_ENABLED,
        RESEND_API_KEY: process.env.RESEND_API_KEY,
        TELNYX_API_KEY: process.env.TELNYX_API_KEY,
        TELNYX_PUBLIC_KEY: process.env.TELNYX_PUBLIC_KEY,
        TELNYX_MESSAGING_PROFILE_ID: process.env.TELNYX_MESSAGING_PROFILE_ID,
        TELNYX_STATUS: process.env.TELNYX_STATUS,
        ATTACHMENTS: platform.env.ATTACHMENTS,
      },
      { webhookTransport: nodeWebhookTransport },
    );
    if (
      cycle.failed.length ||
      Object.values(cycle.results).some((result) =>
        Object.values(result).some((count) => count > 0),
      )
    )
      console.log(JSON.stringify({ event: "background_cycle", ...cycle }));
  } catch {
    console.error("Webhook worker cycle failed");
  }
  await new Promise((r) => setTimeout(r, 2000));
}
await db.$disconnect();
await platform.dispose();
