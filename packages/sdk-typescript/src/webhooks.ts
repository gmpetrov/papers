import { Webhook } from "standardwebhooks";

export class WebhookVerificationError extends Error {
  constructor() {
    super("Invalid webhook signature or payload");
    this.name = "WebhookVerificationError";
  }
}

/** Verify the original UTF-8 request body before using its JSON contents.
 * Successful verification authenticates delivery, not user-supplied event content.
 * Persist webhook-id to deduplicate retries; signatures expire after five minutes.
 */
export function verifyWebhook(
  rawBody: string,
  headers: Headers | Record<string, string>,
  signingSecret: string,
): unknown {
  try {
    const normalized: Record<string, string> = {};
    const entries =
      headers instanceof Headers ? headers.entries() : Object.entries(headers);
    for (const [name, value] of entries) normalized[name.toLowerCase()] = value;
    if (!/^\d{1,12}$/.test(normalized["webhook-timestamp"] ?? ""))
      throw new Error();
    return new Webhook(signingSecret).verify(rawBody, normalized);
  } catch {
    throw new WebhookVerificationError();
  }
}
