import type { AuthEnvironment } from "./index";

/** Runtime bindings are authoritative; Node environment values are a fallback. */
export function resolveAuthEnvironment(
  bindings: Partial<AuthEnvironment>,
  fallback: Partial<AuthEnvironment>,
): AuthEnvironment {
  const secret = bindings.BETTER_AUTH_SECRET ?? fallback.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required");
  return {
    BETTER_AUTH_URL:
      bindings.BETTER_AUTH_URL ??
      fallback.BETTER_AUTH_URL ??
      "http://localhost:3000",
    BETTER_AUTH_SECRET: secret,
    GOOGLE_CLIENT_ID: bindings.GOOGLE_CLIENT_ID ?? fallback.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET:
      bindings.GOOGLE_CLIENT_SECRET ?? fallback.GOOGLE_CLIENT_SECRET,
    RESEND_API_KEY: bindings.RESEND_API_KEY ?? fallback.RESEND_API_KEY,
    AUTH_EMAIL_FROM: bindings.AUTH_EMAIL_FROM ?? fallback.AUTH_EMAIL_FROM,
    BILLING_ENABLED: bindings.BILLING_ENABLED ?? fallback.BILLING_ENABLED,
  };
}
