import type { Database } from "@agentinfra/db";
import { resendClient } from "@agentinfra/providers";

// Structural subset of the native R2 binding. Keep the bucket private.
export interface AttachmentBucket {
  put(
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata: { contentType: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; size: number } | null>;
}
export const maxAttachmentBytes = 25 * 1024 * 1024;

export type MediaTransport = (
  url: string,
  signal: AbortSignal,
) => Promise<Response>;
// Exact provider CDN hosts only; never accept arbitrary Resend subdomains.
const resendAttachmentHosts = new Set([
  "inbound-cdn.resend.com",
  "cdn.resend.app",
]);
class StorageFailure extends Error {}
async function download(
  url: string,
  expectedSize: number | null,
  mediaTransport?: MediaTransport,
) {
  const target = new URL(url);
  if (
    target.protocol !== "https:" ||
    (!mediaTransport && !resendAttachmentHosts.has(target.hostname)) ||
    target.username ||
    target.password ||
    target.port
  )
    throw new StorageFailure("invalid_download_origin");
  if (
    expectedSize !== null &&
    (!Number.isSafeInteger(expectedSize) ||
      expectedSize < 0 ||
      expectedSize > maxAttachmentBytes)
  )
    throw new StorageFailure("attachment_too_large");
  const response = mediaTransport
    ? await mediaTransport(target.href, AbortSignal.timeout(20000))
    : await fetch(target, {
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
      });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new StorageFailure("download_failed");
  }
  const length = response.headers.get("content-length");
  if (length && Number(length) > maxAttachmentBytes) {
    await response.body.cancel();
    throw new StorageFailure("attachment_too_large");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (
        size > maxAttachmentBytes ||
        (expectedSize !== null && size > expectedSize)
      )
        throw new StorageFailure("attachment_size_mismatch");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (expectedSize !== null && size !== expectedSize)
    throw new StorageFailure("attachment_size_mismatch");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

export async function processAttachments(
  db: Database,
  env: { RESEND_API_KEY?: string; ATTACHMENTS?: Pick<AttachmentBucket, "put"> },
  limit = 10,
  mediaTransport?: MediaTransport,
) {
  if (!env.ATTACHMENTS) return { stored: 0 };
  const pending = await db.attachment.findMany({
    where: {
      objectKey: null,
      storageAttempts: { lt: 8 },
      nextStorageAttemptAt: { lte: new Date() },
      OR: [
        ...(env.RESEND_API_KEY
          ? [{ message: { direction: "inbound", providerId: { not: null } } }]
          : []),
        ...(mediaTransport
          ? [{ smsMessage: { direction: "inbound" }, sourceUrl: { not: null } }]
          : []),
      ],
    },
    orderBy: { nextStorageAttemptAt: "asc" },
    take: limit,
    include: {
      message: { select: { organizationId: true, providerId: true } },
      smsMessage: { select: { organizationId: true } },
    },
  });
  let stored = 0;
  for (const attachment of pending) {
    const lease = new Date(Date.now() + 5 * 60_000);
    const claimed = await db.attachment.updateMany({
      where: {
        id: attachment.id,
        objectKey: null,
        storageAttempts: attachment.storageAttempts,
        nextStorageAttemptAt: { lte: new Date() },
      },
      data: { storageAttempts: { increment: 1 }, nextStorageAttemptAt: lease },
    });
    if (!claimed.count) continue;
    try {
      let bytes: ArrayBuffer;
      if (attachment.smsMessage && attachment.sourceUrl && mediaTransport) {
        bytes = await download(
          attachment.sourceUrl,
          attachment.size || null,
          mediaTransport,
        );
      } else {
        const result = await resendClient(
          env.RESEND_API_KEY!,
        ).emails.receiving.attachments.get({
          emailId: attachment.message!.providerId!,
          id: attachment.providerId,
        });
        if (
          result.error ||
          !result.data ||
          result.data.id !== attachment.providerId
        )
          throw new StorageFailure("provider_metadata_unavailable");
        bytes = await download(result.data.download_url, result.data.size);
      }
      const organizationId =
        attachment.message?.organizationId ??
        attachment.smsMessage!.organizationId;
      const objectKey = `attachments/${encodeURIComponent(organizationId)}/${encodeURIComponent(attachment.messageId ?? attachment.smsMessageId!)}/${encodeURIComponent(attachment.id)}`;
      await env.ATTACHMENTS.put(objectKey, bytes, {
        httpMetadata: { contentType: "application/octet-stream" },
      });
      const updated = await db.attachment.updateMany({
        where: {
          id: attachment.id,
          nextStorageAttemptAt: lease,
          objectKey: null,
        },
        data: {
          objectKey,
          size: bytes.byteLength,
          storageError: null,
          sourceUrl: null,
        },
      });
      stored += updated.count;
    } catch (error) {
      await db.attachment.updateMany({
        where: {
          id: attachment.id,
          nextStorageAttemptAt: lease,
          objectKey: null,
        },
        data: {
          storageError:
            error instanceof StorageFailure
              ? error.message
              : "storage_unavailable",
          nextStorageAttemptAt: new Date(
            Date.now() +
              Math.min(3600_000, 30_000 * 2 ** attachment.storageAttempts),
          ),
        },
      });
    }
  }
  return { stored };
}

export function attachmentDisposition(filename: string) {
  const safe =
    filename.replace(/[\r\n\u0000-\u001f\u007f/\\]/g, "_").slice(0, 180) ||
    "attachment";
  const ascii = safe.replace(/[^\x20-\x7e]|[";]/g, "_");
  const encoded = encodeURIComponent(
    new TextDecoder().decode(new TextEncoder().encode(safe)),
  ).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
