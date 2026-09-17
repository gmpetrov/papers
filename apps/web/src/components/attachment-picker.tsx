"use client";
import { useState } from "react";
import type { z } from "zod";
import type { outgoingAttachmentInput } from "@agentinfra/contracts";
export type OutgoingAttachment = z.infer<typeof outgoingAttachmentInput>;
export async function encodeAttachments(
  files: File[],
  maxBytes: number,
): Promise<OutgoingAttachment[]> {
  if (
    files.length > 10 ||
    files.reduce((total, file) => total + file.size, 0) > maxBytes
  )
    throw new Error(
      `Choose up to 10 files totaling at most ${(maxBytes / 1_000_000).toFixed(1)} MB.`,
    );
  return Promise.all(
    files.map(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      return {
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        content: btoa(binary),
      };
    }),
  );
}
export function AttachmentPicker({
  files,
  onChange,
  disabled,
  maxBytes,
}: {
  files: File[];
  onChange(files: File[]): void;
  disabled: boolean;
  maxBytes: number;
}) {
  const [error, setError] = useState("");
  return (
    <div className="field">
      <label>
        Attachments (up to 10 files, {(maxBytes / 1_000_000).toFixed(1)} MB
        total)
        <input
          type="file"
          multiple
          disabled={disabled}
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            if (
              selected.length > 10 ||
              selected.some((file) => !file.size) ||
              selected.reduce((n, file) => n + file.size, 0) > maxBytes
            ) {
              setError(
                "Files must be nonempty and within the attachment limit.",
              );
              event.target.value = "";
              onChange([]);
              return;
            }
            setError("");
            onChange(selected);
          }}
        />
      </label>
      {files.map((file, index) => (
        <div key={index}>
          {file.name} · {(file.size / 1024).toFixed(1)} KB{" "}
          <button
            type="button"
            className="button secondary small"
            disabled={disabled}
            onClick={() => onChange(files.filter((_, i) => i !== index))}
          >
            Remove
          </button>
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
