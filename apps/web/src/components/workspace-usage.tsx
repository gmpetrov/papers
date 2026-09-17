"use client";
import { useEffect, useState } from "react";
type Usage = {
  month: string;
  email: { direction: string; messages: number }[];
  sms: {
    direction: string;
    currency: string | null;
    messages: number;
    messagesWithCost: number;
    messagesWithSegments: number;
    reportedSegments: number | null;
    chargedAmount: string | null;
  }[];
};
export function WorkspaceUsage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<Usage>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetch(`/v1/workspace/usage?month=${encodeURIComponent(month)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error?.message ?? "Unable to load usage");
        if (!controller.signal.aborted) setData(body);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [month]);
  return (
    <section className="panel" aria-labelledby="usage-title">
      <div className="panel-head">
        <h2 id="usage-title">Workspace usage</h2>
      </div>
      <div className="panel-body" style={{ display: "grid", gap: 20 }}>
        <label style={{ maxWidth: 240, display: "grid", gap: 8 }}>
          Month (UTC)
          <input
            className="input"
            type="month"
            value={month}
            min="2000-01"
            max="2099-12"
            onChange={(event) => {
              if (event.target.value) setMonth(event.target.value);
            }}
          />
        </label>
        <p>
          Counts use the month each message was created. Usage charges may
          arrive later. Pending charges are excluded from totals.
        </p>
        {error && <p role="alert">{error}</p>}
        {loading ? (
          <p role="status">Loading usage…</p>
        ) : (
          !error &&
          data && (
            <>
              <h3>Email messages</h3>
              {data.email.length ? (
                <ul>
                  {data.email.map((row) => (
                    <li key={row.direction}>
                      {row.direction}: {row.messages}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No email messages in this month.</p>
              )}
              <h3>SMS usage</h3>
              {data.sms.length ? (
                <div style={{ overflowX: "auto" }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>DIRECTION</th>
                        <th>CURRENCY</th>
                        <th>MESSAGES</th>
                        <th>REPORTED SEGMENTS</th>
                        <th>USAGE CHARGES</th>
                        <th>COST COVERAGE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sms.map((row) => (
                        <tr key={`${row.direction}:${row.currency}`}>
                          <td>{row.direction}</td>
                          <td>{row.currency ?? "Not reported"}</td>
                          <td>{row.messages}</td>
                          <td>
                            {row.reportedSegments ?? "Not reported"}
                            <small style={{ display: "block" }}>
                              {row.messagesWithSegments}/{row.messages} messages
                              reported
                            </small>
                          </td>
                          <td>{row.chargedAmount ?? "Not reported"}</td>
                          <td>
                            {row.messagesWithCost}/{row.messages} messages
                            reported
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>No SMS messages in this month.</p>
              )}
            </>
          )
        )}
        <p className="notice">
          Charges reflect deductions from your Papers prepaid balance. Manage
          subscriptions and invoices in Billing.
        </p>
      </div>
    </section>
  );
}
