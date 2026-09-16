import { Buffer } from "node:buffer";
import { z } from "zod";
import { AppError } from "./errors";
import type { CredentialReference } from "./principal";

const payloadSchema = z
  .object({
    version: z.literal(1),
    attachmentId: z.string().min(1).max(200),
    organizationId: z.string().min(1).max(200),
    credential: z
      .object({
        kind: z.enum(["key", "oauth", "session"]),
        id: z.string().min(1).max(200),
      })
      .strict(),
    resourcePath: z.enum(["/v1", "/mcp"]),
    audience: z.string().max(500),
    issuedAt: z.number().int(),
    expiresAt: z.number().int(),
  })
  .strict();
type LinkPayload = z.infer<typeof payloadSchema>;
async function signingKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
const signedBytes = (payload: string) =>
  new TextEncoder().encode(`papers-attachment-link:v1:${payload}`);
export async function issueAttachmentLink(
  secret: string,
  input: {
    attachmentId: string;
    organizationId: string;
    credential: CredentialReference;
    resourcePath: "/v1" | "/mcp";
    audience: string;
  },
  now = Date.now(),
) {
  const issuedAt = Math.floor(now / 1000);
  const payload = payloadSchema.parse({
    ...input,
    version: 1,
    issuedAt,
    expiresAt: issuedAt + 60,
  });
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret),
    signedBytes(encoded),
  );
  return {
    token: `${encoded}.${Buffer.from(signature).toString("base64url")}`,
    expiresAt: new Date(payload.expiresAt * 1000).toISOString(),
  };
}
export async function verifyAttachmentLink(
  secret: string,
  token: string,
  audience: string,
  now = Date.now(),
): Promise<LinkPayload> {
  try {
    if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))
      throw new Error();
    const [encoded, signature] = token.split(".") as [string, string];
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(secret),
      Buffer.from(signature, "base64url"),
      signedBytes(encoded),
    );
    if (!valid) throw new Error();
    const payload = payloadSchema.parse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    const seconds = Math.floor(now / 1000);
    if (
      payload.audience !== audience ||
      payload.expiresAt <= seconds ||
      payload.issuedAt > seconds ||
      payload.expiresAt - payload.issuedAt !== 60
    )
      throw new Error();
    return payload;
  } catch {
    throw new AppError(
      401,
      "invalid_download_link",
      "Attachment link is invalid or expired",
    );
  }
}
