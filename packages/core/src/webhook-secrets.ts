import { Buffer } from "node:buffer";
import { AppError } from "./errors";

async function key(value: string | undefined) {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value))
    throw new AppError(
      503,
      "webhooks_not_configured",
      "Customer webhook encryption is not configured",
    );
  return crypto.subtle.importKey(
    "raw",
    Buffer.from(value, "base64url"),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
const context = (id: string, version: number) =>
  new TextEncoder().encode(`papers:webhook-secret:${id}:${version}`);
export async function createWebhookSecret(
  encryptionKey: string | undefined,
  id: string,
  version: number,
) {
  const aes = await key(encryptionKey);
  const secret =
    "whsec_" +
    Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: context(id, version) },
    aes,
    new TextEncoder().encode(secret),
  );
  return {
    secret,
    ciphertext: `v1.${Buffer.from(iv).toString("base64url")}.${Buffer.from(ciphertext).toString("base64url")}`,
  };
}
export async function decryptWebhookSecret(
  encryptionKey: string | undefined,
  id: string,
  version: number,
  value: string,
) {
  const aes = await key(encryptionKey);
  try {
    const [format, nonce, encrypted, extra] = value.split(".");
    if (format !== "v1" || !nonce || !encrypted || extra !== undefined)
      throw new Error();
    const bytes = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: Buffer.from(nonce, "base64url"),
        additionalData: context(id, version),
      },
      aes,
      Buffer.from(encrypted, "base64url"),
    );
    return new TextDecoder().decode(bytes);
  } catch {
    throw new AppError(
      503,
      "webhook_secret_unavailable",
      "The webhook signing secret is unavailable",
    );
  }
}
