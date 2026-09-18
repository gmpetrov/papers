"use client";
import { useState } from "react";
type Quote = { phone_number: string };
type Operation = { id: string; status: string; error?: string | null };
async function request(path: string, options?: RequestInit) {
  const response = await fetch("/v1" + path, options);
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error?.message ?? "Unable to complete request");
  return result;
}
export function NumberPurchase({
  keys,
}: {
  onChange: () => void;
  keys: Map<string, string>;
}) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [selected, setSelected] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  async function buy() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    const fingerprint = `phone-checkout:${selected.phone_number}`;
    const key = keys.get(fingerprint) ?? crypto.randomUUID();
    keys.set(fingerprint, key);
    try {
      const result = await request("/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({
          kind: "phone",
          country: "US",
          phoneNumber: selected.phone_number,
        }),
      });
      keys.delete(fingerprint);
      window.location.assign(result.url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div
      className="panel-body"
      style={{ borderBottom: "1px solid var(--line)" }}
    >
      <h3>Get a phone number</h3>
      <p style={{ margin: "10px 0 20px", lineHeight: 1.6 }}>
        Choose a US number, then pay securely with Stripe. Numbers are $3/month
        each, with setup included. SMS uses prepaid credit separately.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {selected ? (
        <div>
          <p className="mono">{selected.phone_number}</p>
          <p>
            <strong>$3/month · No setup fee</strong>
          </p>
          <p style={{ margin: "12px 0" }}>
            Your first paid phone rental includes $0.50 of usage credit, once
            per workspace. No initial top-up required.
          </p>
          <p style={{ margin: "12px 0", color: "var(--muted-foreground)" }}>
            Activation starts after payment. If this number becomes unavailable,
            we cancel and refund the rental. Cancel anytime; the number is
            released at the end of your paid period. Carrier registration may be
            required before messaging.
          </p>
          <div className="row-actions">
            <button
              className="button"
              disabled={busy}
              onClick={() => void buy()}
            >
              {busy ? "Opening Stripe…" : "Continue to checkout · $3/month"}
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              Back to results
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            className="button secondary small"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const result = await request(
                  "/phone-numbers/available?country=US",
                );
                setQuotes(result.data);
                setSearched(true);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Searching…" : "Search US numbers"}
          </button>
          {searched && !quotes.length && (
            <p>No numbers are currently available. Please try again later.</p>
          )}
          {quotes.length > 0 && (
            <table className="table" style={{ marginTop: 20 }}>
              <thead>
                <tr>
                  <th>NUMBER</th>
                  <th>SETUP</th>
                  <th>MONTHLY</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.phone_number}>
                    <td className="mono">{q.phone_number}</td>
                    <td>Included</td>
                    <td>$3 / month</td>
                    <td>
                      <button
                        className="button secondary small"
                        onClick={() => setSelected(q)}
                        aria-label={`Select ${q.phone_number}`}
                      >
                        Select
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
export function NumberRelease({
  number,
  keys,
  onChange,
  onCancel,
}: {
  number: { id: string; phoneNumber: string };
  keys: Map<string, string>;
  onChange: () => void;
  onCancel: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Operation | null>(null);
  const [error, setError] = useState("");
  return (
    <div className="panel-body">
      <h3>Release {number.phoneNumber}</h3>
      <p>
        Releasing stops future use of this number and cannot be undone. Existing
        messages remain in your workspace. Type the number to confirm.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {result ? (
        <p role="status">
          {result.status === "completed"
            ? "Number released."
            : result.status === "failed"
              ? "Release failed. Your number remains assigned."
              : "Release is being confirmed. Refresh the number list to check its status."}
        </p>
      ) : (
        <>
          <div className="field">
            <label htmlFor="release-number-confirmation">
              Phone number to release
            </label>
            <input
              id="release-number-confirmation"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </div>
          <button
            className="button"
            disabled={busy || confirmation !== number.phoneNumber}
            onClick={async () => {
              setBusy(true);
              setError("");
              const fingerprint = `number-release:${number.id}`;
              const key = keys.get(fingerprint) ?? crypto.randomUUID();
              keys.set(fingerprint, key);
              try {
                setResult(
                  await request(
                    `/phone-numbers/${encodeURIComponent(number.id)}`,
                    { method: "DELETE", headers: { "Idempotency-Key": key } },
                  ),
                );
                onChange();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Releasing…" : "Confirm release"}
          </button>
        </>
      )}
      <button className="button secondary" disabled={busy} onClick={onCancel}>
        Close
      </button>
    </div>
  );
}
