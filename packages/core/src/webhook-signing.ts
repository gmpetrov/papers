import { Webhook } from "standardwebhooks";
import { decryptWebhookSecret } from "./webhook-secrets";

interface SigningEndpoint {
  id: string;
  secretVersion: number;
  secretCiphertext: string;
  previousSecretCiphertext: string | null;
  previousSecretExpiresAt: Date | null;
}

/** Sign a stable delivery ID and the exact serialized payload sent on the wire.
 * Retries retain the ID/body but obtain a fresh timestamp and current keys.
 */
export async function signWebhookDelivery(
  endpoint: SigningEndpoint,
  encryptionKey: string | undefined,
  deliveryId: string,
  rawBody: string,
  now = new Date(),
): Promise<Record<string, string>> {
  if (
    !/^[A-Za-z0-9_-]{1,200}$/.test(deliveryId) ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Invalid webhook delivery metadata");
  const secrets = [
    await decryptWebhookSecret(
      encryptionKey,
      endpoint.id,
      endpoint.secretVersion,
      endpoint.secretCiphertext,
    ),
  ];
  if (
    endpoint.previousSecretCiphertext &&
    endpoint.previousSecretExpiresAt &&
    endpoint.previousSecretExpiresAt > now
  ) {
    secrets.push(
      await decryptWebhookSecret(
        encryptionKey,
        endpoint.id,
        endpoint.secretVersion - 1,
        endpoint.previousSecretCiphertext,
      ),
    );
  }
  return {
    "content-type": "application/json",
    "webhook-id": deliveryId,
    "webhook-timestamp": String(Math.floor(now.getTime() / 1000)),
    "webhook-signature": secrets
      .map((secret) => new Webhook(secret).sign(deliveryId, now, rawBody))
      .join(" "),
  };
}
