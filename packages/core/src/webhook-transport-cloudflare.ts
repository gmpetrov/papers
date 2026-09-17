import { webhookEndpointInput } from "@agentinfra/contracts";
import type { WebhookTransport } from "./webhook-delivery";

/** Only for a deployed standalone Cloudflare Worker with no origin routes.
 * Cloudflare's global fetch is public-Internet-only in that deployment model.
 * Never substitute Node fetch, a VPC/service binding, or local workerd fetch.
 * Local development uses the DNS-pinned Node adapter instead.
 */
export function cloudflareWebhookTransport(
  publicInternetFetch: typeof fetch,
): WebhookTransport {
  return async ({ url, body, headers, signal }) => {
    const destination = webhookEndpointInput.shape.url.parse(url);
    signal.throwIfAborted();
    const response = await publicInternetFetch(destination, {
      method: "POST",
      body,
      signal,
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        "webhook-id": headers["webhook-id"]!,
        "webhook-timestamp": headers["webhook-timestamp"]!,
        "webhook-signature": headers["webhook-signature"]!,
      },
    });
    // Unbounded receiver bodies are never read, retained, or logged.
    await response.body?.cancel();
    return response.status;
  };
}

/** Same standalone public-Internet-only deployment requirement as webhooks. */
export function cloudflareMediaTransport(publicInternetFetch: typeof fetch) {
  return (url: string, signal: AbortSignal) =>
    publicInternetFetch(webhookEndpointInput.shape.url.parse(url), {
      signal,
      redirect: "manual",
    });
}
