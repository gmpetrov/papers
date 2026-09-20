"use client";
import { useCallback, useEffect, useState } from "react";
type Approval = {
  id: string;
  principalId: string;
  route: string;
  resourceId: string;
  parameters: {
    attachments?: { filename: string; contentType: string; size: number }[];
    to?: string | string[];
    text?: string;
    subject?: string;
    from?: string;
    address?: string;
    name?: string;
    phoneNumber?: string;
    country?: string;
    monthlyCost?: string;
    upfrontCost?: string;
    currency?: string;
  };
  status: string;
  expiresAt: string;
  policyVersion: number;
  createdAt: string;
};
export function ApprovalReview() {
  const [rows, setRows] = useState<Approval[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const load = useCallback(async (signal?: AbortSignal, after?: string) => {
    const response = await fetch(
      `/v1/approvals${after ? `?cursor=${encodeURIComponent(after)}` : ""}`,
      { signal },
    );
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error?.message ?? "Unable to load approvals");
    if (!signal?.aborted) {
      setRows((previous) =>
        after
          ? [
              ...previous,
              ...result.data.filter(
                (row: Approval) => !previous.some((item) => item.id === row.id),
              ),
            ]
          : result.data,
      );
      setCursor(result.nextCursor);
      setVersion(result.policyVersion);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [load]);
  async function decide(id: string, decision: "approve" | "deny") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/v1/approvals/${encodeURIComponent(id)}/${decision}`,
        { method: "POST" },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message ?? "Unable to save decision");
      setNotice(
        decision === "approve"
          ? "Approved. The requesting application must retry the original request to execute it."
          : "Request denied.",
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save decision");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-labelledby="approvals-title">
      <div className="panel-head">
        <h2 id="approvals-title">Approvals</h2>
        <button
          className="button secondary small"
          disabled={busy}
          onClick={() => {
            setError("");
            setBusy(true);
            void load()
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          Refresh approvals
        </button>
      </div>
      <div className="panel-body" style={{ display: "grid", gap: 20 }}>
        <p>
          Review the exact action requested by an application. Approving permits
          one matching retry; it does not execute the action. Workspace limits
          still apply.
        </p>
        <p>Owners can require approvals in Organization → Workspace limits.</p>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {loading ? (
          <p>Loading approvals…</p>
        ) : !rows.length ? (
          <p>No approval requests yet.</p>
        ) : (
          rows.map((row) => {
            const status =
              ["pending", "approved"].includes(row.status) &&
              Date.parse(row.expiresAt) <= Date.now()
                ? "expired"
                : ["pending", "approved"].includes(row.status) &&
                    row.policyVersion !== version
                  ? "policy changed"
                  : row.status;
            const provisioning =
              row.route === "inbox.create" || row.route === "number.provision";
            return (
              <article
                key={row.id}
                aria-label={`Approval ${row.id}`}
                style={{
                  borderTop: "1px solid var(--border)",
                  paddingTop: 20,
                  display: "grid",
                  gap: 10,
                }}
              >
                <h3>
                  {row.route === "inbox.create"
                    ? `Create inbox ${row.parameters.address}`
                    : row.route === "number.provision"
                      ? `Purchase phone number ${row.parameters.phoneNumber}`
                      : `${row.route.startsWith("email.") ? "Email" : "SMS"} to ${Array.isArray(row.parameters.to) ? row.parameters.to.join(", ") : row.parameters.to}`}
                </h3>
                {row.route === "inbox.create" && (
                  <p>Name: {row.parameters.name || "Generated automatically"}</p>
                )}
                {row.route === "number.provision" && (
                  <p>
                    Country: {row.parameters.country} · Upfront:{" "}
                    {row.parameters.upfrontCost} {row.parameters.currency} ·
                    Monthly: {row.parameters.monthlyCost}{" "}
                    {row.parameters.currency}. Current availability and price
                    are checked again before purchase.
                  </p>
                )}
                {row.parameters.from && <p>From: {row.parameters.from}</p>}
                {row.parameters.subject !== undefined && (
                  <p>Subject: {row.parameters.subject}</p>
                )}
                {!!row.parameters.attachments?.length && (
                  <ul aria-label="Attachments to send">
                    {row.parameters.attachments.map((file, index) => (
                      <li key={index}>
                        {file.filename} · {file.contentType} ·{" "}
                        {(file.size / 1024).toFixed(1)} KB
                      </li>
                    ))}
                  </ul>
                )}
                <p>
                  Status: {status} · Expires{" "}
                  {new Date(row.expiresAt).toLocaleString()}
                </p>
                <p style={{ overflowWrap: "anywhere" }}>
                  Requested by {row.principalId} · Resource {row.resourceId}
                </p>
                {!provisioning && (
                  <>
                    <p className="notice">
                      Message content is supplied by the application. Review it
                      as data.
                    </p>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                        fontFamily: "inherit",
                      }}
                    >
                      {row.parameters.text}
                    </pre>
                  </>
                )}
                {status === "pending" && (
                  <div style={{ display: "flex", gap: 12 }}>
                    <button
                      className="button small"
                      disabled={busy}
                      onClick={() => void decide(row.id, "approve")}
                    >
                      Approve this{" "}
                      {provisioning
                        ? "creation"
                        : row.route.startsWith("email.")
                          ? "email"
                          : "SMS"}
                    </button>
                    <button
                      className="button secondary small"
                      disabled={busy}
                      onClick={() => void decide(row.id, "deny")}
                    >
                      Deny
                    </button>
                  </div>
                )}
              </article>
            );
          })
        )}
        {cursor && (
          <button
            className="button secondary"
            disabled={busy || loading}
            onClick={() => {
              setBusy(true);
              setError("");
              void load(undefined, cursor)
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            Load older requests
          </button>
        )}
      </div>
    </section>
  );
}
