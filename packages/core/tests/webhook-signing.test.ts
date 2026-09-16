import { createHmac } from "node:crypto";
import { expect, it, vi } from "vitest";
import { signWebhookDelivery } from "../src/webhook-signing";
import { createWebhookSecret } from "../src/webhook-secrets";
import {
  verifyWebhook,
  WebhookVerificationError,
} from "../../sdk-typescript/src/webhooks";

it("signs exact Unicode JSON compatible with HMAC-SHA256, and both rotation keys during grace", async () => {
  const now = new Date();
  const key = Buffer.alloc(32, 7).toString("base64url");
  const old = await createWebhookSecret(key, "endpoint", 1);
  const current = await createWebhookSecret(key, "endpoint", 2);
  const endpoint = {
    id: "endpoint",
    secretVersion: 2,
    secretCiphertext: current.ciphertext,
    previousSecretCiphertext: old.ciphertext,
    previousSecretExpiresAt: new Date(+now + 3600000),
  };
  const body = '{"type":"sms.received","text":"Bonjour 🌍"}';
  const headers = await signWebhookDelivery(
    endpoint,
    key,
    "delivery_123",
    body,
    now,
  );
  const expected = createHmac(
    "sha256",
    Buffer.from(current.secret.slice(6), "base64"),
  )
    .update(`delivery_123.${Math.floor(+now / 1000)}.${body}`)
    .digest("base64");
  expect(headers["webhook-signature"]?.split(" ")[0]).toBe(`v1,${expected}`);
  expect(verifyWebhook(body, new Headers(headers), old.secret)).toEqual(
    JSON.parse(body),
  );
  expect(verifyWebhook(body, headers, current.secret)).toEqual(
    JSON.parse(body),
  );
  const later = new Date(+now + 3600000);
  const expired = await signWebhookDelivery(
    endpoint,
    key,
    "delivery_123",
    body,
    later,
  );
  vi.useFakeTimers();
  try {
    vi.setSystemTime(later);
    expect(() => verifyWebhook(body, expired, old.secret)).toThrow(
      WebhookVerificationError,
    );
    expect(verifyWebhook(body, expired, current.secret)).toEqual(
      JSON.parse(body),
    );
  } finally {
    vi.useRealTimers();
  }
});

it("rejects changed bodies/IDs, expired or future timestamps, missing and malformed headers", async () => {
  const now = new Date();
  const key = Buffer.alloc(32, 8).toString("base64url");
  const secret = await createWebhookSecret(key, "endpoint", 1);
  const endpoint = {
    id: "endpoint",
    secretVersion: 1,
    secretCiphertext: secret.ciphertext,
    previousSecretCiphertext: null,
    previousSecretExpiresAt: null,
  };
  const body = '{"type":"email.received"}';
  const headers = await signWebhookDelivery(
    endpoint,
    key,
    "delivery",
    body,
    now,
  );
  expect(() => verifyWebhook(body + " ", headers, secret.secret)).toThrow(
    WebhookVerificationError,
  );
  for (const patch of [
    { "webhook-id": "other" },
    { "webhook-signature": "v1" },
    { "webhook-timestamp": headers["webhook-timestamp"] + "junk" },
    { "webhook-id": "" },
  ]) {
    expect(() =>
      verifyWebhook(body, { ...headers, ...patch }, secret.secret),
    ).toThrow(WebhookVerificationError);
  }
  for (const offset of [-301000, 301000]) {
    const outdated = await signWebhookDelivery(
      endpoint,
      key,
      "delivery",
      body,
      new Date(+now + offset),
    );
    expect(() => verifyWebhook(body, outdated, secret.secret)).toThrow(
      WebhookVerificationError,
    );
  }
});
