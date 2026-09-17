"use client";
import { NumberPurchase, NumberRelease } from "./number-purchase";
import { SmsComposer } from "./sms-composer";
import { useEffect, useRef, useState } from "react";

type NumberRow = {
  id: string;
  phoneNumber: string;
  agentId: string | null;
  lastError?: string | null;
  status: string;
};
type Sms = {
  recipientOptOut?: {
    status: "blocked" | "not_blocked" | "unknown";
    observedAt: string | null;
  };
  segments: number | null;
  costAmount: string | null;
  costCurrency: string | null;
  id: string;
  from: string;
  to: string;
  direction: string;
  status: string;
  createdAt: string;
  text?: string;
};
async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/v1" + path, { signal });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error?.message ?? "Unable to load phone data");
  return data;
}
export function PhoneDashboard({ canSend }: { canSend: boolean }) {
  const keys = useRef(new Map<string, string>());
  const [purchasing, setPurchasing] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [compose, setCompose] = useState(false);
  const [numbers, setNumbers] = useState<NumberRow[]>([]);
  const [numberCursor, setNumberCursor] = useState<string | null>(null);
  const [loadingNumbers, setLoadingNumbers] = useState(false);
  const numberRequest = useRef<AbortController | null>(null);
  const [providerStatus, setProviderStatus] = useState("");
  const [selected, setSelected] = useState<NumberRow | null>(null);
  const [messages, setMessages] = useState<Sms[]>([]);
  const [message, setMessage] = useState<Sms | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [checkoutNotice, setCheckoutNotice] = useState("");
  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("checkout");
    if (status === "canceled") {
      setCheckoutNotice(
        "Checkout canceled. You can choose another number whenever you are ready.",
      );
      return;
    }
    if (status !== "success") return;
    setCheckoutNotice(
      "Checkout submitted. Your number will appear below after payment confirmation and activation. If the number is no longer available, the rental is canceled and refunded automatically.",
    );
    let checks = 0;
    const timer = window.setInterval(() => {
      setRevision((v) => v + 1);
      if (++checks >= 15) window.clearInterval(timer);
    }, 4000);
    return () => window.clearInterval(timer);
  }, []);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    numberRequest.current?.abort();
    setLoadingNumbers(false);
    setLoading(true);
    setError("");
    void read<{ data: NumberRow[]; status: string; nextCursor: string | null }>(
      "/phone-numbers",
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setNumbers(result.data);
        setNumberCursor(result.nextCursor);
        setSelected((prior) =>
          prior ? (result.data.find((n) => n.id === prior.id) ?? null) : null,
        );
        setProviderStatus(result.status);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      numberRequest.current?.abort();
      request.current?.abort();
    };
  }, [revision]);
  async function loadMoreNumbers() {
    if (!numberCursor || loadingNumbers) return;
    numberRequest.current?.abort();
    const controller = new AbortController();
    numberRequest.current = controller;
    setLoadingNumbers(true);
    setError("");
    try {
      const page = await read<{ data: NumberRow[]; nextCursor: string | null }>(
        `/phone-numbers?cursor=${encodeURIComponent(numberCursor)}`,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setNumbers((prior) => [
        ...prior,
        ...page.data.filter((row) => !prior.some((item) => item.id === row.id)),
      ]);
      setNumberCursor(page.nextCursor);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof Error
            ? error.message
            : "Unable to load phone numbers",
        );
    } finally {
      if (!controller.signal.aborted) setLoadingNumbers(false);
    }
  }
  async function loadMessages(number: NumberRow, next?: string) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setSelected(number);
    setReleasing(false);
    setCompose(false);
    setMessage(null);
    setError("");
    setBusy(true);
    if (!next) {
      setMessages([]);
      setCursor(null);
    }
    try {
      const page = await read<{ data: Sms[]; nextCursor: string | null }>(
        `/phone-numbers/${encodeURIComponent(number.id)}/messages${next ? `?cursor=${encodeURIComponent(next)}` : ""}`,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setMessages((prior) => (next ? [...prior, ...page.data] : page.data));
        setCursor(page.nextCursor);
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Unable to read messages");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function openMessage(id: string) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setMessage(null);
    try {
      const result = await read<Sms>(
        `/sms/${encodeURIComponent(id)}`,
        controller.signal,
      );
      if (!controller.signal.aborted) setMessage(result);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Unable to read message");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function back() {
    request.current?.abort();
    setBusy(false);
    setError("");
    setMessage(null);
    setSelected(null);
    setReleasing(false);
    setCompose(false);
    setMessages([]);
    setCursor(null);
  }
  return (
    <div className="panel">
      <div className="panel-head">
        <span>{selected ? selected.phoneNumber : "Phone numbers"}</span>
        <div className="row-actions">
          {!selected && canSend && providerStatus === "active" && (
            <button
              className="button small"
              onClick={() => setPurchasing((v) => !v)}
            >
              {purchasing ? "Close search" : "Get a number"}
            </button>
          )}
          {selected &&
            ["active", "billing_suspended"].includes(selected.status) &&
            canSend &&
            providerStatus === "active" && (
              <button
                className="button secondary small"
                onClick={() => {
                  setReleasing((v) => !v);
                  setCompose(false);
                }}
              >
                Release number
              </button>
            )}

          {selected &&
            canSend &&
            providerStatus === "active" &&
            selected.status === "active" && (
              <button
                className="button small"
                onClick={() => {
                  setReleasing(false);
                  setCompose((v) => !v);
                }}
              >
                {compose ? "Close composer" : "Compose SMS"}
              </button>
            )}
          {selected && (
            <button className="button secondary small" onClick={back}>
              All numbers
            </button>
          )}
          <button
            className="button secondary small"
            disabled={busy || loading}
            onClick={() => {
              setRevision((v) => v + 1);
              if (selected) void loadMessages(selected);
            }}
          >
            Refresh
          </button>
        </div>
      </div>
      {purchasing && !selected && (
        <NumberPurchase
          keys={keys.current}
          onChange={() => setRevision((v) => v + 1)}
        />
      )}
      {releasing && selected && (
        <NumberRelease
          number={selected}
          keys={keys.current}
          onChange={() => setRevision((v) => v + 1)}
          onCancel={() => {
            setReleasing(false);
            back();
          }}
        />
      )}
      {compose && selected && selected.status === "active" && (
        <SmsComposer
          key={selected.id}
          numberId={selected.id}
          address={selected.phoneNumber}
          keys={keys.current}
        />
      )}
      {checkoutNotice && (
        <p className="notice" role="status">
          {checkoutNotice}
        </p>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {loading ? (
        <div className="panel-body">Loading phone numbers…</div>
      ) : !selected ? (
        <>
          {providerStatus !== "active" && (
            <div className="notice">
              Phone activation is pending. Existing messages remain available to
              read.
            </div>
          )}
          {numbers.length ? (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>NUMBER</th>
                    <th>STATUS</th>
                    <th>MESSAGES</th>
                  </tr>
                </thead>
                <tbody>
                  {numbers.map((number) => (
                    <tr key={number.id}>
                      <td className="mono">{number.phoneNumber}</td>
                      <td>
                        <span className="badge">
                          {number.status.replaceAll("_", " ")}
                        </span>
                        {number.lastError && (
                          <small>{number.lastError.replaceAll("_", " ")}</small>
                        )}
                      </td>
                      <td>
                        <button
                          className="button secondary small"
                          aria-label={`View SMS for ${number.phoneNumber}`}
                          onClick={() => void loadMessages(number)}
                        >
                          View SMS
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {numberCursor && (
                <div className="panel-body">
                  <button
                    className="button secondary small"
                    disabled={loadingNumbers}
                    onClick={() => void loadMoreNumbers()}
                  >
                    {loadingNumbers
                      ? "Loading phone numbers…"
                      : "Load more phone numbers"}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="panel-body">
              <h3>No phone numbers assigned yet.</h3>
              <p>
                Search for an SMS-capable number to start sending and receiving
                messages in this workspace.
              </p>
            </div>
          )}
        </>
      ) : (
        <>
          {message ? (
            <article className="panel-body">
              <button
                className="button secondary small"
                onClick={() => setMessage(null)}
              >
                Back to messages
              </button>
              <h3 style={{ marginTop: 18 }}>SMS from {message.from}</h3>
              <p>
                To {message.to} · {message.status} ·{" "}
                {new Date(message.createdAt).toLocaleString()}
              </p>
              <p>
                Segments: {message.segments ?? "Not reported"} · Usage charge:{" "}
                {message.costAmount != null && message.costCurrency
                  ? `${message.costAmount} ${message.costCurrency}`
                  : "Not reported"}
              </p>
              <div className="notice">
                <p>
                  SMS opt-out status for{" "}
                  {message.direction === "inbound" ? message.from : message.to}:{" "}
                  {message.recipientOptOut?.status === "blocked"
                    ? "Blocked — recipient opted out"
                    : message.recipientOptOut?.status === "not_blocked"
                      ? "Latest observed action: opted back in"
                      : "Unknown — no opt-in or opt-out event observed"}
                </p>
                {message.recipientOptOut?.observedAt && (
                  <p>
                    Last observed{" "}
                    {new Date(
                      message.recipientOptOut.observedAt,
                    ).toLocaleString()}
                    .
                  </p>
                )}
                <p>
                  This status applies across the messaging profile. It is not
                  proof of consent or guaranteed delivery.
                </p>
              </div>
              <p className="notice">External message content</p>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  fontFamily: "inherit",
                }}
              >
                {message.text || "(Empty message)"}
              </pre>
            </article>
          ) : (
            <>
              {busy && (
                <div role="status" className="panel-body">
                  Loading messages…
                </div>
              )}
              {messages.length ? (
                <div style={{ overflowX: "auto" }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>CONTACT</th>
                        <th>DIRECTION</th>
                        <th>STATUS</th>
                        <th>RECEIVED</th>
                      </tr>
                    </thead>
                    <tbody>
                      {messages.map((sms) => (
                        <tr key={sms.id}>
                          <td>
                            <button
                              className="text-link"
                              disabled={busy}
                              onClick={() => void openMessage(sms.id)}
                            >
                              {sms.direction === "inbound" ? sms.from : sms.to}
                            </button>
                          </td>
                          <td>{sms.direction}</td>
                          <td>{sms.status}</td>
                          <td>{new Date(sms.createdAt).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                !busy &&
                !error && <div className="panel-body">No SMS messages yet.</div>
              )}
              {cursor && (
                <div className="panel-body">
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void loadMessages(selected, cursor)}
                  >
                    Load older messages
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
