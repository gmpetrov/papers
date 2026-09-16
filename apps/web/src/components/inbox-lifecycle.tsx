"use client";
import { useState } from "react";

export function InboxLifecycle({
  id,
  status,
  onChanged,
}: {
  id: string;
  status: string;
  onChanged: (status: "active" | "archived") => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const archived = status === "archived";
  const next = archived ? "active" : "archived";
  const label = archived ? "Reactivate inbox" : "Archive inbox";
  return (
    <details className="panel-body">
      <summary>{label}</summary>
      <p>
        {archived
          ? "Resume sending and storing new email. Reactivation requires available inbox capacity. Email received while archived is not recovered."
          : "Stop new sends and storage of incoming email for this inbox. Existing messages stay readable and the address remains reserved. You can reactivate it later if capacity allows."}
      </p>
      {error && <p role="alert">{error}</p>}
      <button
        className="button secondary small"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const response = await fetch(
              `/v1/inboxes/${encodeURIComponent(id)}`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: next }),
              },
            );
            if (!response.ok)
              throw new Error(
                (await response.json()).error?.message ??
                  "Unable to update inbox",
              );
            onChanged(next);
          } catch (error) {
            setError(
              error instanceof Error ? error.message : "Unable to update inbox",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Saving…" : label}
      </button>
    </details>
  );
}
