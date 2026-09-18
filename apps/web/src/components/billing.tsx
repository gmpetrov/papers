"use client";
import { useEffect, useState } from "react";
import { plans, topupAmounts } from "@agentinfra/contracts";
import Link from "next/link";
type Summary = {
  plan: string;
  status: string;
  periodEnd: string | null;
  balanceMicros: string;
  reservedMicros: string;
  availableMicros: string;
  blocked: boolean;
  emailUsage: number;
  emailAllowance: number;
  autoTopup: boolean;
  autoTopupAmountCents: number;
  autoTopupThresholdCents: number;
  autoTopupMonthlyLimitCents: number;
  hasPaymentMethod: boolean;
  ledger: {
    id: string;
    kind: string;
    description: string;
    amountMicros: string;
    createdAt: string;
  }[];
  rentals: {
    id: string;
    phoneNumberId: string | null;
    status: string;
    paidUntil: string | null;
    cancelAtPeriodEnd: boolean;
  }[];
  rates: {
    prefix: string;
    reservationUSDPerSegment: number;
    expiresAt: string;
  }[];
};
const dollars = (micros: string) =>
  (Number(micros) / 1e6).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
async function api(path = "", body?: unknown, method = "POST") {
  const res = await fetch(
    `/v1/billing${path}`,
    body === undefined
      ? undefined
      : {
          method,
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Unable to load billing");
  return data;
}
export function Billing({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function reload() {
    setData(await api());
  }
  useEffect(() => {
    let active = true;
    api()
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function action(path: string, body: unknown, method = "POST") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api(path, body, method);
      if (result.url) window.location.assign(result.url);
      else {
        await reload();
        setNotice(
          result.scheduled
            ? "Downgrade scheduled for your next renewal."
            : result.pending
              ? "Payment requires attention. Open Manage subscription to complete payment."
              : "Saved.",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ display: "grid", gap: 24 }}>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {!data ? (
        <p>Loading billing…</p>
      ) : (
        <>
          {data.blocked && (
            <p className="notice error">
              Spending is paused while a payment or provider charge is
              reconciled. Contact support.
            </p>
          )}
          <section className="panel">
            <div className="panel-header">
              <h2>Workspace plan</h2>
              <Link href="/pricing" className="text-link">
                Compare plans →
              </Link>
            </div>
            <div className="panel-body">
              <p>
                <strong style={{ textTransform: "capitalize" }}>
                  {data.plan}
                </strong>{" "}
                · {data.status}
                {data.periodEnd
                  ? ` · Current period ends ${new Date(data.periodEnd).toLocaleDateString()}`
                  : ""}
              </p>
              <p>
                {data.emailUsage.toLocaleString()} /{" "}
                {data.emailAllowance.toLocaleString()} emails used this period.
              </p>
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  flexWrap: "wrap",
                  marginTop: 18,
                }}
              >
                {(["developer", "scale"] as const)
                  .filter((id) => data.plan !== id)
                  .map((id) => (
                    <button
                      className="button secondary"
                      key={id}
                      disabled={busy || !canEdit}
                      onClick={() =>
                        void action(
                          data.plan === "free" ? "/checkout" : "/plan",
                          data.plan === "free"
                            ? { kind: "plan", plan: id }
                            : { plan: id },
                        )
                      }
                    >
                      {plans[id].name} · ${plans[id].monthlyCents / 100}/month
                    </button>
                  ))}
                <button
                  className="button secondary"
                  disabled={busy || !canEdit}
                  onClick={() => void action("/portal", {})}
                >
                  Manage subscription & invoices
                </button>
              </div>
              <p style={{ color: "var(--muted-foreground)", marginTop: 16 }}>
                Upgrades are prorated. Workspace safety limits still apply;
                adjust them in Organization settings when you need more
                capacity. Downgrades take effect at renewal. Cancellation takes
                effect at renewal.
              </p>
            </div>
          </section>
          <section className="panel">
            <div className="panel-header">
              <h2>Prepaid usage balance</h2>
              <button
                className="button secondary small"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  reload()
                    .catch((e) => setError(e.message))
                    .finally(() => setBusy(false));
                }}
              >
                Refresh
              </button>
            </div>
            <div className="panel-body">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
                  gap: 22,
                  marginBottom: 25,
                }}
              >
                {[
                  ["Balance", data.balanceMicros],
                  ["Pending sends", data.reservedMicros],
                  ["Available to spend", data.availableMicros],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div style={{ color: "var(--muted-foreground)", marginBottom: 8 }}>
                      {label}
                    </div>
                    <strong style={{ fontSize: 25 }}>{dollars(value!)}</strong>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {topupAmounts.map((amount) => (
                  <button
                    className="button secondary"
                    disabled={busy || !canEdit}
                    key={amount}
                    onClick={() =>
                      void action("/checkout", {
                        kind: "topup",
                        amountCents: amount,
                      })
                    }
                  >
                    Add ${amount / 100}
                  </button>
                ))}
              </div>
              <p
                style={{
                  lineHeight: 1.7,
                  color: "var(--muted-foreground)",
                  marginTop: 16,
                }}
              >
                Credit is added after payment succeeds. It pays for sent and
                received SMS and email overages ($2 / 1,000). Purchased credit
                carries forward. SMS charges depend on the destination and
                message segments. An estimate is reserved before sending;
                unknown outcomes keep their reservation.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void action(
                    "/auto-topup",
                    {
                      autoTopup: f.get("enabled") === "on",
                      autoTopupAmountCents: Number(f.get("amount")) * 100,
                      autoTopupThresholdCents: Number(f.get("threshold")) * 100,
                      autoTopupMonthlyLimitCents: Number(f.get("limit")) * 100,
                    },
                    "PATCH",
                  );
                }}
                style={{
                  borderTop: "1px solid var(--line)",
                  paddingTop: 20,
                  marginTop: 20,
                }}
              >
                <label
                  style={{ display: "flex", gap: 10, alignItems: "center" }}
                >
                  <input
                    type="checkbox"
                    name="enabled"
                    defaultChecked={data.autoTopup}
                    disabled={!canEdit || !data.hasPaymentMethod}
                  />{" "}
                  Automatically top up my balance using my saved card
                </label>
                <div
                  style={{
                    display: "flex",
                    gap: 16,
                    flexWrap: "wrap",
                    margin: "16px 0",
                  }}
                >
                  {[
                    [
                      "amount",
                      "Add ($)",
                      data.autoTopupAmountCents / 100,
                      10,
                      100,
                    ],
                    [
                      "threshold",
                      "When available falls below ($)",
                      data.autoTopupThresholdCents / 100,
                      2,
                      100,
                    ],
                    [
                      "limit",
                      "Maximum automatic top-ups / UTC month ($)",
                      data.autoTopupMonthlyLimitCents / 100,
                      10,
                      1000,
                    ],
                  ].map(([name, label, value, min, max]) => (
                    <label key={name} style={{ display: "grid", gap: 8 }}>
                      {label}
                      <input
                        name={String(name)}
                        type="number"
                        step="1"
                        min={Number(min)}
                        max={Number(max)}
                        defaultValue={Number(value)}
                        disabled={!canEdit}
                        required
                        style={{
                          padding: 10,
                          border: "1px solid var(--line)",
                          borderRadius: 6,
                          maxWidth: 160,
                        }}
                      />
                    </label>
                  ))}
                </div>
                <button
                  className="button secondary"
                  disabled={busy || !canEdit}
                >
                  Save automatic top-up settings
                </button>
                {!data.hasPaymentMethod && (
                  <p style={{ marginTop: 12, color: "var(--muted-foreground)" }}>
                    Make a manual top-up first to save a card. Automatic top-ups
                    require your explicit opt-in.
                  </p>
                )}
              </form>
            </div>
          </section>
          <section className="panel">
            <div className="panel-header">
              <h2>Phone rentals</h2>
            </div>
            <div className="panel-body">
              <p>
                Standard US numbers are $3/month each, with prepaid SMS charged
                separately.
              </p>
              <p style={{ marginTop: 12, color: "var(--muted-foreground)" }}>
                Choose your number first, then subscribe through Stripe.
                Canceling a rental releases its number at the end of the paid
                period; unpaid rentals are suspended and released after seven
                days. Manage or cancel rentals in the billing portal. No upfront
                top-up is required. Your first paid phone rental includes $0.50
                of usage credit, once per workspace.
              </p>
              <Link
                className="button secondary"
                style={{ marginTop: 16 }}
                href="/dashboard/numbers"
              >
                Choose a number · $3/month
              </Link>
              {data.rentals.map((r) => (
                <p key={r.id} style={{ marginTop: 12 }}>
                  {r.phoneNumberId ?? "Unassigned rental"} · {r.status}
                  {r.cancelAtPeriodEnd ? " · Cancels at renewal" : ""}
                </p>
              ))}
            </div>
          </section>
          <section className="panel">
            <div className="panel-header">
              <h2>Usage transactions</h2>
            </div>
            <div className="panel-body">
              {!data.ledger.length ? (
                <p>No transactions yet.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>Date</th>
                        <th style={{ textAlign: "left" }}>Description</th>
                        <th style={{ textAlign: "right" }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.ledger.map((e) => (
                        <tr key={e.id}>
                          <td
                            style={{
                              padding: "14px 0",
                              borderTop: "1px solid var(--line)",
                            }}
                          >
                            {new Date(e.createdAt).toLocaleDateString()}
                          </td>
                          <td style={{ borderTop: "1px solid var(--line)" }}>
                            {e.description}
                          </td>
                          <td
                            style={{
                              textAlign: "right",
                              borderTop: "1px solid var(--line)",
                            }}
                          >
                            {dollars(e.amountMicros)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
