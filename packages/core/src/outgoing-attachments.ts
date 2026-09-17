import { Buffer } from "node:buffer";
import type { z } from "zod";
import type { outgoingAttachmentInput } from "@agentinfra/contracts";
import type { AttachmentBucket } from "./attachments";
import { assert, hash } from "./errors";

type Input = z.infer<typeof outgoingAttachmentInput>;
export const maxOutgoingEmailBytes = 5 * 1024 * 1024;
export const maxOutgoingMmsBytes = 1_000_000;
const mmsTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/vcard",
  "text/calendar",
  "audio/mpeg",
  "audio/amr",
  "video/mp4",
]);
export function validateOutgoingAttachments(
  inputs: Input[] = [],
  channel: "email" | "sms",
) {
  let total = 0;
  for (const input of inputs) {
    const bytes = Buffer.from(input.content, "base64");
    assert(
      bytes.toString("base64") === input.content && bytes.length > 0,
      400,
      "invalid_attachment",
      "Attachment content must be nonempty canonical base64",
    );
    total += bytes.length;
    assert(
      channel !== "sms" || mmsTypes.has(input.contentType.toLowerCase()),
      400,
      "unsupported_media_type",
      "Unsupported MMS attachment type",
    );
  }
  assert(
    total <= (channel === "sms" ? maxOutgoingMmsBytes : maxOutgoingEmailBytes),
    413,
    "attachments_too_large",
    "Combined attachment size exceeds the channel limit",
  );
}
export function attachmentSummary(inputs: Input[] = []) {
  return inputs.map(({ content, ...metadata }) => ({
    ...metadata,
    size: Buffer.byteLength(content, "base64"),
  }));
}

// Storage completes before a provider can accept the send. Objects use random IDs,
// never client filenames. A rolled-back DB transaction can leave an orphan object.
export async function storeOutgoingAttachments(
  bucket: AttachmentBucket | undefined,
  organizationId: string,
  messageId: string,
  inputs: Input[] = [],
  mediaBaseUrl?: string,
) {
  if (!inputs.length) return { records: [], mediaUrls: [] as string[] };
  assert(
    bucket,
    503,
    "storage_unavailable",
    "Attachment storage is not configured",
  );
  const records = [];
  const mediaUrls: string[] = [];
  for (const input of inputs) {
    const id = crypto.randomUUID();
    const objectKey = `attachments/${encodeURIComponent(organizationId)}/${encodeURIComponent(messageId)}/${id}`;
    const bytes = Buffer.from(input.content, "base64");
    await bucket.put(objectKey, Uint8Array.from(bytes).buffer, {
      httpMetadata: { contentType: "application/octet-stream" },
    });
    const token = mediaBaseUrl
      ? crypto.randomUUID() + crypto.randomUUID()
      : undefined;
    records.push({
      id,
      providerId: id,
      filename: input.filename,
      contentType: input.contentType,
      size: bytes.length,
      objectKey,
      ...(token
        ? {
            providerTokenHash: await hash(token),
            providerTokenExpiresAt: new Date(Date.now() + 60 * 60_000),
          }
        : {}),
    });
    if (token) {
      const url = new URL(`/v1/attachment-media/${id}`, mediaBaseUrl);
      url.searchParams.set("token", token);
      mediaUrls.push(url.href);
    }
  }
  return { records, mediaUrls };
}
