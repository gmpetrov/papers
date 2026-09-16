"use client";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { numberSearchInput } from "@agentinfra/contracts";
import type { z } from "zod";
type Quote = {
  phone_number: string;
  phone_number_type?: string;
  cost_information: {
    upfront_cost: string;
    monthly_cost: string;
    currency: string;
  };
};
type Operation = { id: string; status: string; error?: string | null };
async function request(path: string, options?: RequestInit) {
  const response = await fetch("/v1" + path, options);
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error?.message ?? "Unable to complete request");
  return result;
}
export function NumberPurchase({
  onChange,
  keys,
}: {
  onChange: () => void;
  keys: Map<string, string>;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<
    z.input<typeof numberSearchInput>,
    unknown,
    z.output<typeof numberSearchInput>
  >({
    resolver: zodResolver(numberSearchInput),
    defaultValues: { country: "US" },
  });
  const [country, setCountry] = useState("US");
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [selected, setSelected] = useState<Quote | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const submitted = useRef(false);
  async function buy() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    submitted.current = true;
    const body = {
      country,
      phoneNumber: selected.phone_number,
      monthlyCost: selected.cost_information.monthly_cost,
      upfrontCost: selected.cost_information.upfront_cost,
      currency: selected.cost_information.currency,
    };
    const fingerprint = "number-purchase:" + JSON.stringify(body);
    const key = keys.get(fingerprint) ?? crypto.randomUUID();
    keys.set(fingerprint, key);
    try {
      const result = await request("/phone-numbers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify(body),
      });
      setOperation(result);
      if (result.status === "failed") keys.delete(fingerprint);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function check() {
    if (!operation) return;
    setBusy(true);
    setError("");
    try {
      setOperation(
        await request(`/operations/${encodeURIComponent(operation.id)}`),
      );
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
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
        Choose an SMS-capable number for this workspace. Monthly rental and
        messaging charges apply. Some countries and US messaging require
        additional registration.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {operation ? (
        <div className="notice" role="status">
          <p>
            {operation.status === "completed"
              ? "Your number is ready."
              : operation.status === "failed"
                ? `Purchase failed: ${operation.error ?? "provider rejected the order"}.`
                : "Your purchase is being confirmed. Do not place another order for this number."}
          </p>
          {["pending", "unknown"].includes(operation.status) && (
            <button
              className="button secondary small"
              disabled={busy}
              onClick={() => void check()}
            >
              Check purchase status
            </button>
          )}
          {["completed", "failed"].includes(operation.status) && (
            <button
              className="button secondary small"
              onClick={() => {
                setOperation(null);
                setSelected(null);
                setQuotes([]);
                setSearched(false);
                submitted.current = false;
              }}
            >
              Search again
            </button>
          )}
        </div>
      ) : selected ? (
        <div>
          <p className="mono">{selected.phone_number}</p>
          <p>
            {selected.cost_information.currency}{" "}
            {Number(selected.cost_information.upfront_cost).toFixed(2)} upfront
            · {selected.cost_information.currency}{" "}
            {Number(selected.cost_information.monthly_cost).toFixed(2)} / month.
            Messaging usage is billed separately.
          </p>
          <div className="row-actions">
            <button
              className="button"
              disabled={busy}
              onClick={() => void buy()}
            >
              {busy
                ? "Submitting…"
                : submitted.current
                  ? "Retry purchase status"
                  : "Confirm purchase"}
            </button>
            {!submitted.current && (
              <button
                className="button secondary"
                onClick={() => setSelected(null)}
              >
                Back to results
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <form
            onSubmit={handleSubmit(async (values) => {
              setError("");
              setQuotes([]);
              setSearched(false);
              try {
                const result = await request(
                  `/phone-numbers/available?country=${encodeURIComponent(values.country)}`,
                );
                setQuotes(result.data);
                setCountry(values.country);
                setSearched(true);
              } catch (e) {
                setError((e as Error).message);
              }
            })}
          >
            <div className="field" style={{ maxWidth: 260 }}>
              <label htmlFor="number-country">Country code</label>
              <input
                id="number-country"
                placeholder="US"
                maxLength={2}
                {...register("country", {
                  setValueAs: (v: string) => v.toUpperCase(),
                })}
              />
              <small>{errors.country?.message}</small>
            </div>
            <button className="button secondary small" disabled={isSubmitting}>
              {isSubmitting ? "Searching…" : "Search numbers"}
            </button>
          </form>
          {searched && !quotes.length && (
            <p>No SMS-capable numbers are available for this country.</p>
          )}
          {quotes.length > 0 && (
            <div style={{ overflowX: "auto", marginTop: 20 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>NUMBER</th>
                    <th>UPFRONT</th>
                    <th>MONTHLY</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((q) => (
                    <tr key={q.phone_number}>
                      <td className="mono">{q.phone_number}</td>
                      <td>
                        {q.cost_information.currency}{" "}
                        {Number(q.cost_information.upfront_cost).toFixed(2)}
                      </td>
                      <td>
                        {q.cost_information.currency}{" "}
                        {Number(q.cost_information.monthly_cost).toFixed(2)}
                      </td>
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
            </div>
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
