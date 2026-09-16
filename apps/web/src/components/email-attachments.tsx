"use client";
import { useState } from "react";
import {
  attachmentInfoSchema,
  type AttachmentInfo,
} from "@agentinfra/contracts";

export function EmailAttachments({
  messageId,
  initial,
}: {
  messageId: string;
  initial: AttachmentInfo[];
}) {
  const [attachments, setAttachments] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (!attachments.length) return null;
  async function refresh() {
    setBusy("refresh");
    setError("");
    try {
      const response = await fetch(
        `/v1/messages/${encodeURIComponent(messageId)}`,
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "Could not refresh attachments");
      setAttachments(attachmentInfoSchema.array().parse(body.attachments));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not refresh attachments",
      );
    } finally {
      setBusy(null);
    }
  }
  async function download(attachment: AttachmentInfo) {
    setBusy(attachment.id);
    setError("");
    let url: string | undefined;
    try {
      const response = await fetch(
        `/v1/attachments/${encodeURIComponent(attachment.id)}/download`,
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error?.message ?? "Could not download attachment");
      }
      url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download =
        attachment.filename.replace(/[\u0000-\u001f\u007f/\\]/g, "_") ||
        "attachment";
      document.body.append(link);
      link.click();
      link.remove();
      // Give the browser time to start consuming the blob before releasing it.
      const completedUrl = url;
      setTimeout(() => URL.revokeObjectURL(completedUrl), 1000);
      url = undefined;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not download attachment",
      );
    } finally {
      if (url) URL.revokeObjectURL(url);
      setBusy(null);
    }
  }
  return (
    <section
      aria-label="Email attachments"
      style={{ display: "grid", gap: 14, margin: "20px 0" }}
    >
      <div className="row-actions">
        <h3>Attachments</h3>
        <button
          className="button secondary small"
          disabled={busy !== null}
          onClick={() => void refresh()}
        >
          Refresh attachments
        </button>
      </div>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {attachments.map((attachment) => (
          <li
            key={attachment.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <strong style={{ overflowWrap: "anywhere" }}>
                {attachment.filename}
              </strong>
              <div className="muted">
                {(attachment.size / 1024).toFixed(1)} KB ·{" "}
                {attachment.contentType}
              </div>
            </div>
            {attachment.storageStatus === "ready" ? (
              <button
                className="button secondary small"
                aria-label={`Download ${attachment.filename}`}
                disabled={busy !== null}
                onClick={() => void download(attachment)}
              >
                {busy === attachment.id ? "Downloading…" : "Download"}
              </button>
            ) : (
              <span>
                {attachment.storageStatus === "pending"
                  ? "Processing"
                  : attachment.storageStatus === "failed"
                    ? "Download unavailable"
                    : "Storage unavailable"}
              </span>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
    </section>
  );
}
