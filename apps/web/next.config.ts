import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { resolve } from "node:path";
if (process.env.NODE_ENV === "development") {
  void initOpenNextCloudflareForDev({
    persist: { path: resolve(process.cwd(), "../../.wrangler/shared") },
  });
}
const config: NextConfig = {
  outputFileTracingIncludes: {
    "/*": [
      "../../node_modules/.pnpm/pg-cloudflare@*/node_modules/pg-cloudflare/dist/**/*",
    ],
  },
  transpilePackages: [
    "@agentinfra/auth",
    "@agentinfra/core",
    "@agentinfra/db",
    "@agentinfra/contracts",
    "@agentinfra/providers",
  ],
  allowedDevOrigins: ["dev.chaindesk.ai"],
};
export default config;
