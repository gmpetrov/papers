import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { resolve } from "node:path";

if (process.env.NODE_ENV === "development") {
  void initOpenNextCloudflareForDev({
    persist: { path: resolve(process.cwd(), "../../.wrangler/shared") },
  });
}

// Rewrites are baked into the build. The upstream Mintlify deployment must
// also use /docs as its base path so navigation and assets keep this prefix.
const mintlifyDocsOrigin = (process.env.MINTLIFY_DOCS_ORIGIN ?? "")
  .trim()
  .replace(/\/$/, "");

const config: NextConfig = {
  async rewrites() {
    if (!mintlifyDocsOrigin) {
      return [];
    }

    return {
      beforeFiles: [
        {
          source: "/.well-known/vercel/:path*",
          destination: `${mintlifyDocsOrigin}/.well-known/vercel/:path*`,
        },
        {
          source: "/_mintlify/:path*",
          destination: `${mintlifyDocsOrigin}/_mintlify/:path*`,
        },
        {
          source: "/api/request",
          destination: `${mintlifyDocsOrigin}/_mintlify/api/request`,
        },
        {
          source: "/docs",
          destination: `${mintlifyDocsOrigin}/docs`,
        },
        {
          source: "/docs/:path*",
          destination: `${mintlifyDocsOrigin}/docs/:path*`,
        },
        {
          source: "/mintlify-assets/:path*",
          destination: `${mintlifyDocsOrigin}/mintlify-assets/:path*`,
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
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
