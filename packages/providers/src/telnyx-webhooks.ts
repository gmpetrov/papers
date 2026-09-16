import { z } from "zod";
const phone = z.string().regex(/^\+[1-9]\d{6,14}$/);
const telnyxEventSchema = z.object({
  data: z.object({
    id: z.string().min(1).max(200),
    event_type: z.string(),
    occurred_at: z.iso.datetime({ offset: true }),
    payload: z
      .object({
        id: z.string().min(1),
        direction: z.enum(["inbound", "outbound"]),
        type: z.string(),
        messaging_profile_id: z.string(),
        webhook_url: z.url().nullable().optional(),
        from: z.object({ phone_number: phone }),
        to: z
          .array(
            z.object({ phone_number: phone, status: z.string().optional() }),
          )
          .min(1),
        text: z.string().nullable().optional(),
      })
      .passthrough(),
  }),
});
export type TelnyxEvent = z.infer<typeof telnyxEventSchema>;
export async function verifyTelnyxWebhook(
  payload: string,
  headers: Headers,
  publicKey: string,
) {
  const timestamp = headers.get("telnyx-timestamp") ?? "";
  if (
    !/^\d+$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
  )
    throw new Error("Invalid webhook timestamp");
  const signature = Uint8Array.from(
    atob(headers.get("telnyx-signature-ed25519") ?? ""),
    (c) => c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(publicKey), (c) => c.charCodeAt(0)),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  if (
    !(await crypto.subtle.verify(
      "Ed25519",
      key,
      signature,
      new TextEncoder().encode(`${timestamp}|${payload}`),
    ))
  )
    throw new Error("Invalid webhook signature");
  return telnyxEventSchema.parse(JSON.parse(payload));
}
