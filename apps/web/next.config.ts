import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { resolve } from "node:path";

if (process.env.NODE_ENV === "development") {
  void initOpenNextCloudflareForDev({
    persist: { path: resolve(process.cwd(), "../../.wrangler/shared") },
  });
}

const mintlifyDocsOrigin = (
  process.env.MINTLIFY_DOCS_ORIGIN ??
  (process.env.NODE_ENV === "development" ? "http://127.0.0.1:3001" : "")
).replace(/\/$/, "");
const mintlifyDocsIsLocal = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(
  mintlifyDocsOrigin,
);
const mintlifyDocsBasePath = (
  process.env.MINTLIFY_DOCS_BASE_PATH ?? (mintlifyDocsIsLocal ? "" : "/docs")
).replace(/\/$/, "");

const config: NextConfig = {
  async rewrites() {
    if (!mintlifyDocsOrigin) {
      return [];
    }

    return {
      beforeFiles: [
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
          destination: `${mintlifyDocsOrigin}${mintlifyDocsBasePath || "/"}`,
        },
        {
          source: "/docs/:path*",
          destination: `${mintlifyDocsOrigin}${mintlifyDocsBasePath}/:path*`,
        },
        {
          source: "/mintlify-assets/:path*",
          destination: `${mintlifyDocsOrigin}/mintlify-assets/:path*`,
        },
        ...(mintlifyDocsIsLocal
          ? [
              {
                source: "/logo/:path*",
                destination: `${mintlifyDocsOrigin}/logo/:path*`,
              },
              {
                source: "/favicons/:path*",
                destination: `${mintlifyDocsOrigin}/favicons/:path*`,
              },
            ]
          : []),
      ],
      afterFiles: [],
      fallback: mintlifyDocsIsLocal
        ? [
            {
              source: "/_next/:path*",
              destination: `${mintlifyDocsOrigin}/_next/:path*`,
            },
          ]
        : [],
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
