"use client";
import { useEffect, useRef, useState } from "react";

type Grants = { inboxIds: string[]; phoneNumberIds: string[] };
type Resource = {
  id: string;
  name?: string;
  address?: string;
  phoneNumber?: string;
  status: string;
};

function ResourceChoices({
  kind,
  organizationId,
  selected,
  onChange,
}: {
  kind: "inboxes" | "phone-numbers";
  organizationId?: string;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [rows, setRows] = useState<Resource[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const controller = useRef<AbortController | null>(null);
  async function load(after?: string) {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams({
        limit: "50",
        ...(after ? { cursor: after } : {}),
      });
      const endpoint = organizationId
        ? `/api/oauth/resource-options?${new URLSearchParams({ organizationId, kind, ...(after ? { cursor: after } : {}) })}`
        : `/v1/${kind}?${query}`;
      const response = await fetch(endpoint, {
        signal: current.signal,
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error?.message ?? "Unable to load resources");
      if (current.signal.aborted) return;
      setRows(
        (previous) =>
          [
            ...new Map(
              [...(after ? previous : []), ...data.data].map(
                (row: Resource) => [row.id, row],
              ),
            ).values(),
          ] as Resource[],
      );
      setCursor(data.nextCursor);
    } catch (error) {
      if (!current.signal.aborted)
        setError(
          error instanceof Error ? error.message : "Unable to load resources",
        );
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [kind, organizationId]);
  const label = kind === "inboxes" ? "Inboxes" : "Phone numbers";
  return (
    <fieldset
      style={{
        border: "1px solid var(--line)",
        borderRadius: 6,
        padding: 12,
        margin: "12px 0",
      }}
    >
      <legend>
        {label} ({selected.length} selected)
      </legend>
      {rows.map((row) => (
        <label
          key={row.id}
          style={{
            display: "flex",
            gap: 8,
            alignItems: "baseline",
            marginBottom: 8,
          }}
        >
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={selected.includes(row.id)}
            disabled={!selected.includes(row.id) && selected.length >= 100}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...selected, row.id]
                  : selected.filter((id) => id !== row.id),
              )
            }
          />
          <span>
            {row.address ?? row.phoneNumber}
            {row.name ? ` · ${row.name}` : ""} <small>({row.status})</small>
          </span>
        </label>
      ))}
      {!busy && !error && !rows.length && (
        <p>No {label.toLowerCase()} in this workspace.</p>
      )}
      {busy && <p role="status">Loading {label.toLowerCase()}…</p>}
      {error && <p role="alert">{error}</p>}
      {!busy && (cursor || error) && (
        <button
          type="button"
          className="button secondary small"
          onClick={() => void load(cursor ?? undefined)}
        >
          {error ? "Retry" : `Load more ${label.toLowerCase()}`}
        </button>
      )}
      {selected.length >= 100 && (
        <small>Up to 100 {label.toLowerCase()} per selection.</small>
      )}
    </fieldset>
  );
}

export function KeyResourcePicker({
  value,
  onChange,
  organizationId,
}: {
  organizationId?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  let grants: Grants = { inboxIds: [], phoneNumberIds: [] };
  if (value) {
    try {
      grants = JSON.parse(value);
    } catch {
      /* Form validation prevents submission. */
    }
  }
  return (
    <div>
      <select
        id="resourceSelection"
        value={value ? "selected" : "workspace"}
        onChange={(event) =>
          onChange(
            event.target.value === "selected"
              ? JSON.stringify({ inboxIds: [], phoneNumberIds: [] })
              : "",
          )
        }
      >
        <option value="workspace">All workspace resources</option>
        <option value="selected">Selected inboxes and phone numbers</option>
      </select>
      {value ? (
        <>
          <p>
            Access covers only the resources you select. It cannot create
            inboxes or purchase numbers. Nothing selected means no resource
            access.
          </p>
          <ResourceChoices
            kind="inboxes"
            organizationId={organizationId}
            selected={grants.inboxIds}
            onChange={(inboxIds) =>
              onChange(JSON.stringify({ ...grants, inboxIds }))
            }
          />
          <ResourceChoices
            kind="phone-numbers"
            organizationId={organizationId}
            selected={grants.phoneNumberIds}
            onChange={(phoneNumberIds) =>
              onChange(JSON.stringify({ ...grants, phoneNumberIds }))
            }
          />
        </>
      ) : (
        <small>
          Includes existing and future resources, subject to the key’s
          permissions and limits.
        </small>
      )}
    </div>
  );
}
