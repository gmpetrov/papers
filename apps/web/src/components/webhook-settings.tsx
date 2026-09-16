"use client";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { webhookEndpointInput } from "@agentinfra/contracts";
import type { z } from "zod";

type Endpoint = {
  id: string;
  name: string;
  url: string;
  eventTypes: string[];
  enabled: boolean;
  previousSecretExpiresAt: string | null;
};
type Delivery = {
  id: string;
  eventId: string;
  status: string;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  availableAt: string;
};
type Attempt = {
  attempt: number;
  startedAt: string;
  finishedAt: string | null;
  statusCode: number | null;
  error: string | null;
};
const events = [
  "email.received",
  "email.sent",
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.suppressed",
  "sms.received",
  "sms.queued",
  "sms.sent",
  "sms.delivered",
  "sms.failed",
  "inbox.created",
  "number.activated",
  "number.released",
];
async function request<T>(
  path = "",
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/v1/webhook-endpoints${path}`, {
    method,
    signal,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error?.message ?? "Webhook request failed");
  return result;
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Webhook request failed";

export function WebhookSettings() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [canEnable, setDeliveryAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Endpoint | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [secret, setSecret] = useState("");
  const [selected, setSelected] = useState<Endpoint | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<{
    id: string;
    logs: Attempt[];
  } | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof webhookEndpointInput>>({
    resolver: zodResolver(webhookEndpointInput),
    defaultValues: {
      name: "",
      url: "",
      eventTypes: ["email.received", "sms.received"],
    },
  });
  const load = useCallback(async (signal?: AbortSignal) => {
    const result = await request<{
      data: Endpoint[];
      canEnable: boolean;
    }>("", "GET", undefined, signal);
    setDeliveryAvailable(result.canEnable);
    setEndpoints(result.data);
    setSelected((current) =>
      current
        ? (result.data.find((row) => row.id === current.id) ?? null)
        : null,
    );
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal)
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [load]);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function history(endpoint: Endpoint, next?: string) {
    const result = await request<{
      data: Delivery[];
      nextCursor: string | null;
    }>(
      `/${encodeURIComponent(endpoint.id)}/deliveries?limit=10${next ? `&cursor=${encodeURIComponent(next)}` : ""}`,
    );
    setSelected(endpoint);
    setDeliveries((old) => (next ? [...old, ...result.data] : result.data));
    setCursor(result.nextCursor);
    setAttempts(null);
  }
  return (
    <section
      className="panel"
      style={{ marginBottom: 24 }}
      aria-labelledby="webhooks-title"
    >
      <div className="panel-head">
        <h2 id="webhooks-title">Webhooks</h2>
        <button
          className="button secondary small"
          disabled={busy || !!secret}
          onClick={() => {
            setEditing(null);
            reset({
              name: "",
              url: "",
              eventTypes: ["email.received", "sms.received"],
            });
            setShowForm(true);
          }}
        >
          Add endpoint
        </button>
      </div>
      <div className="panel-body" style={{ display: "grid", gap: 18 }}>
        <p>
          Set up an HTTPS endpoint for workspace events. Save your signing
          secret, then enable the endpoint to receive new events.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {secret && (
          <div role="status" style={{ display: "grid", gap: 12 }}>
            <strong>Save your signing secret</strong>
            <p>
              This secret is shown once. Store it securely in your receiving
              application.
            </p>
            <input
              aria-label="Webhook signing secret"
              value={secret}
              readOnly
              type="password"
              autoComplete="off"
            />
            <div style={{ display: "flex", gap: 12 }}>
              <button
                className="button secondary small"
                onClick={() =>
                  void action(async () => {
                    await navigator.clipboard.writeText(secret);
                  })
                }
              >
                Copy signing secret
              </button>
              <button
                className="button secondary small"
                onClick={() => setSecret("")}
              >
                I saved it
              </button>
            </div>
          </div>
        )}
        {showForm && (
          <form
            style={{ display: "grid", gap: 14 }}
            onSubmit={handleSubmit(async (input) => {
              setError("");
              try {
                const result = await request<
                  Endpoint & { signingSecret?: string }
                >(
                  editing ? `/${encodeURIComponent(editing.id)}` : "",
                  editing ? "PATCH" : "POST",
                  input,
                );
                if (result.signingSecret) setSecret(result.signingSecret);
                setShowForm(false);
                await load();
              } catch (e) {
                setError(message(e));
              }
            })}
          >
            <label>
              Name
              <input {...register("name")} placeholder="My automation" />
            </label>
            {errors.name && <p role="alert">{errors.name.message}</p>}
            <label>
              Endpoint URL
              <input
                {...register("url")}
                type="url"
                placeholder="https://your-app.com/webhooks/papers"
              />
            </label>
            {errors.url && <p role="alert">{errors.url.message}</p>}
            <fieldset
              style={{ border: "1px solid var(--border)", padding: 14 }}
            >
              <legend>Events</legend>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
                {Array.from(
                  new Set([...events, ...(editing?.eventTypes ?? [])]),
                ).map((type) => (
                  <label
                    key={type}
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <input
                      type="checkbox"
                      value={type}
                      {...register("eventTypes")}
                      style={{ width: "auto" }}
                    />
                    {type}
                  </label>
                ))}
              </div>
            </fieldset>
            {errors.eventTypes && (
              <p role="alert">{errors.eventTypes.message}</p>
            )}
            <div style={{ display: "flex", gap: 12 }}>
              <button className="button small" disabled={isSubmitting}>
                {isSubmitting
                  ? "Saving…"
                  : editing
                    ? "Save endpoint"
                    : "Create endpoint"}
              </button>
              <button
                type="button"
                className="button secondary small"
                disabled={isSubmitting}
                onClick={() => setShowForm(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
        {loading ? (
          <p>Loading endpoints…</p>
        ) : !endpoints.length ? (
          <p>No webhook endpoints yet.</p>
        ) : (
          endpoints.map((endpoint) => (
            <div
              key={endpoint.id}
              style={{
                borderTop: "1px solid var(--border)",
                paddingTop: 16,
                display: "grid",
                gap: 10,
              }}
            >
              <strong>
                {endpoint.name} · {endpoint.enabled ? "Enabled" : "Disabled"}
              </strong>
              <p style={{ overflowWrap: "anywhere" }}>{endpoint.url}</p>
              <p>{endpoint.eventTypes.join(", ")}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button
                  className="button secondary small"
                  disabled={busy || !!secret || isSubmitting}
                  onClick={() => {
                    setEditing(endpoint);
                    reset({
                      name: endpoint.name,
                      url: endpoint.url,
                      eventTypes: endpoint.eventTypes,
                    });
                    setShowForm(true);
                  }}
                >
                  Edit
                </button>
                <button
                  className="button secondary small"
                  disabled={
                    busy ||
                    !!secret ||
                    isSubmitting ||
                    (!endpoint.enabled && !canEnable)
                  }
                  onClick={() =>
                    void action(async () => {
                      await request(
                        `/${encodeURIComponent(endpoint.id)}`,
                        "PATCH",
                        { enabled: !endpoint.enabled },
                      );
                      await load();
                      if (selected?.id === endpoint.id)
                        await history({
                          ...endpoint,
                          enabled: !endpoint.enabled,
                        });
                    })
                  }
                >
                  {endpoint.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  className="button secondary small"
                  disabled={
                    busy ||
                    !!secret ||
                    isSubmitting ||
                    !!(
                      endpoint.previousSecretExpiresAt &&
                      Date.parse(endpoint.previousSecretExpiresAt) > Date.now()
                    )
                  }
                  onClick={() =>
                    void action(async () => {
                      const result = await request<{ signingSecret: string }>(
                        `/${encodeURIComponent(endpoint.id)}/rotate-secret`,
                        "POST",
                      );
                      setSecret(result.signingSecret);
                      await load();
                    })
                  }
                >
                  Rotate secret
                </button>
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={() => void action(() => history(endpoint))}
                >
                  Delivery history
                </button>
                <button
                  className="button secondary small"
                  disabled={busy || !!secret || isSubmitting}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete ${endpoint.name} and its delivery history?`,
                      )
                    )
                      void action(async () => {
                        await request(
                          `/${encodeURIComponent(endpoint.id)}`,
                          "DELETE",
                        );
                        if (selected?.id === endpoint.id) setSelected(null);
                        if (editing?.id === endpoint.id) setShowForm(false);
                        await load();
                      });
                  }}
                >
                  Delete
                </button>
              </div>
              {endpoint.previousSecretExpiresAt &&
                Date.parse(endpoint.previousSecretExpiresAt) > Date.now() && (
                  <p>
                    Previous secret remains valid until{" "}
                    {new Date(
                      endpoint.previousSecretExpiresAt,
                    ).toLocaleString()}
                    .
                  </p>
                )}
            </div>
          ))
        )}
        {selected && (
          <section
            aria-label="Webhook delivery history"
            style={{ display: "grid", gap: 12 }}
          >
            <h3>Delivery history: {selected.name}</h3>
            <button
              className="button secondary small"
              disabled={busy}
              onClick={() => void action(() => history(selected))}
            >
              Refresh history
            </button>
            {!deliveries.length ? (
              <p>No deliveries recorded for this endpoint.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>CREATED</th>
                      <th>STATUS</th>
                      <th>ATTEMPTS</th>
                      <th>HTTP</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {deliveries.map((delivery) => (
                      <tr key={delivery.id}>
                        <td>{new Date(delivery.createdAt).toLocaleString()}</td>
                        <td>
                          {delivery.status}
                          {delivery.lastError ? ` · ${delivery.lastError}` : ""}
                        </td>
                        <td>{delivery.attempts}</td>
                        <td>{delivery.lastStatusCode ?? "—"}</td>
                        <td>
                          <button
                            className="button secondary small"
                            disabled={busy}
                            onClick={() =>
                              void action(async () => {
                                setAttempts(
                                  await request(
                                    `/${encodeURIComponent(selected.id)}/deliveries/${encodeURIComponent(delivery.id)}`,
                                  ),
                                );
                              })
                            }
                          >
                            View attempts
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {cursor && (
              <button
                className="button secondary small"
                disabled={busy}
                onClick={() => void action(() => history(selected, cursor))}
              >
                Load older deliveries
              </button>
            )}
            {attempts && (
              <div>
                <h4>Attempts for {attempts.id}</h4>
                {attempts.logs.length ? (
                  <ul>
                    {attempts.logs.map((log) => (
                      <li key={log.attempt}>
                        {log.attempt}.{" "}
                        {new Date(log.startedAt).toLocaleString()} ·{" "}
                        {log.statusCode ?? "No HTTP response"} ·{" "}
                        {log.error ??
                          (log.finishedAt ? "Completed" : "In progress")}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No attempts yet.</p>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </section>
  );
}
