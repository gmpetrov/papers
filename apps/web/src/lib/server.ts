import { createDatabase } from "@agentinfra/db/edge";
import { createAuth, resolveAuthEnvironment } from "@agentinfra/auth";
import { createApi, type Environment } from "@agentinfra/core";
import { getCloudflareContext } from "@opennextjs/cloudflare";
// The database record is authoritative; queue notification failure is recoverable by cron.
export function wakeBackgroundJobs() {
  try {
    const { env, ctx } = getCloudflareContext();
    ctx.waitUntil(
      env.JOBS_QUEUE.send({ version: 1, type: "background.wakeup" }).catch(
        () => {
          console.warn(JSON.stringify({ event: "jobs_notification_failed" }));
        },
      ),
    );
  } catch {
    console.warn(JSON.stringify({ event: "jobs_notification_unavailable" }));
  }
}
export function providerEnv(): Environment {
  return {
    BILLING_ENABLED: process.env.BILLING_ENABLED,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PORTAL_CONFIGURATION_ID: process.env.STRIPE_PORTAL_CONFIGURATION_ID,
    BILLING_PUBLIC_ORIGIN: process.env.BETTER_AUTH_URL,
    CUSTOM_WEBHOOK_ENCRYPTION_KEY: process.env.CUSTOM_WEBHOOK_ENCRYPTION_KEY,
    EMAIL_DOMAIN: process.env.EMAIL_DOMAIN,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
    TELNYX_API_KEY: process.env.TELNYX_API_KEY,
    TELNYX_PUBLIC_KEY: process.env.TELNYX_PUBLIC_KEY,
    TELNYX_MESSAGING_PROFILE_ID: process.env.TELNYX_MESSAGING_PROFILE_ID,
    TELNYX_WEBHOOK_URL:
      process.env.TELNYX_WEBHOOK_URL ||
      (process.env.BETTER_AUTH_URL
        ? new URL("/api/webhooks/telnyx", process.env.BETTER_AUTH_URL).href
        : undefined),
    TELNYX_STATUS: process.env.TELNYX_STATUS,
  };
}
export async function runtime(request?: Request) {
  const bindings = getCloudflareContext().env;
  const db = createDatabase(bindings.HYPERDRIVE.connectionString);
  let auth: ReturnType<typeof createAuth> | undefined;
  let authSettled: Promise<void> | undefined;
  let api: ReturnType<typeof createApi> | undefined;
  let mcpApi: ReturnType<typeof createApi> | undefined;
  const getAuth = () => {
    if (auth) return auth;
    auth = createAuth(db, resolveAuthEnvironment(bindings, process.env), {
      resourceGrants:
        request && new URL(request.url).pathname === "/api/auth/oauth2/consent"
          ? (request.headers.get("x-papers-resource-grants") ?? undefined)
          : undefined,
      organizationId:
        request?.headers.get("x-papers-organization-id") ?? undefined,
    });
    // Better Auth starts async OAuth resource seeding immediately. Observe its
    // rejection even when a caller only reads options, and finish that work
    // before disconnecting the request's database. API calls still receive the
    // original rejected $context; this does not turn initialization into success.
    authSettled = auth.$context.then(
      () => {},
      () => {},
    );
    return auth;
  };
  const bucket = bindings.ATTACHMENTS;
  const environment: Environment = {
    ...providerEnv(),
    ATTACHMENTS: {
      put: (key, value, options) => bucket.put(key, value, options),
      get: async (key) => {
        const object = await bucket.get(key);
        // Worker and DOM declarations differ, but both expose a standard byte stream.
        return object
          ? {
              body: object.body as unknown as ReadableStream,
              size: object.size,
            }
          : null;
      },
    },
  };
  return {
    db,
    get auth() {
      return getAuth();
    },
    get api() {
      return (api ??= createApi(db, getAuth(), environment));
    },
    get mcpApi() {
      return (mcpApi ??= createApi(db, getAuth(), environment, "/mcp"));
    },
    close: async () => {
      await authSettled;
      await db.$disconnect();
    },
  };
}
export async function withRuntime<T>(
  fn: (r: Awaited<ReturnType<typeof runtime>>) => Promise<T>,
  request?: Request,
) {
  const r = await runtime(request);
  try {
    return await fn(r);
  } finally {
    await r.close();
  }
}
