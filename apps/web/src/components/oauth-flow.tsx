"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { authClient, oauthFlowClient } from "@agentinfra/auth/client";
import { KeyResourcePicker } from "./key-resource-picker";
import { Brand } from "./brand";

const scopeLabels: Record<string, string> = {
  "agents:read": "View agents",
  "inboxes:read": "Read inboxes and email content",
  "inboxes:write": "Create and manage inboxes and read status",
  "email:send": "Send email on your behalf",
  "sms:send": "Send SMS from assigned numbers",
  "sms:read": "Read SMS messages",
  "numbers:provision": "Purchase phone numbers (upfront and monthly charges)",
  "numbers:release": "Permanently release phone numbers",
  "numbers:read": "View and search phone numbers",
  "events:read": "Read activity events",
  offline_access: "Stay connected using renewable access tokens",
};

export function OAuthFlow({ mode }: { mode: "organization" | "consent" }) {
  const query = useSearchParams();
  const [organizations, setOrganizations] = useState<
    { id: string; name: string }[]
  >([]);
  const [organizationId, setOrganizationId] = useState(
    query.get("papers_org") ?? "",
  );
  const [resourceSelection, setResourceSelection] = useState("");
  const [clientName, setClientName] = useState("Agent application");
  const [scopes, setScopes] = useState(
    (query.get("scope") ?? "").split(" ").filter(Boolean),
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        const session = await authClient.getSession();
        if (!session.data) {
          window.location.href =
            "/login?next=" +
            encodeURIComponent(
              window.location.pathname + window.location.search,
            );
          return;
        }
        if (session.data.session.impersonatedBy)
          throw new Error(
            "Stop impersonating before connecting an application.",
          );
        const result = await authClient.organization.list();
        if (result.error) throw new Error(result.error.message);
        setOrganizations(result.data ?? []);
        setOrganizationId((id) => id || result.data?.[0]?.id || "");
        const clientId = query.get("client_id");
        if (!clientId)
          throw new Error(
            "This authorization request is missing its client ID. Start again from your agent.",
          );
        const response = await fetch(
          "/api/auth/oauth2/public-client?client_id=" +
            encodeURIComponent(clientId),
        );
        if (!response.ok)
          throw new Error(
            "Unable to load this application. Start again from your agent.",
          );
        const client = await response.json();
        setClientName(client.name ?? client.client_name ?? "Agent application");
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Unable to load authorization",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [query]);
  async function submit(accept = true) {
    setBusy(true);
    setError("");
    try {
      const fetchOptions = {
        headers: {
          "x-papers-organization-id": organizationId,
          ...(mode === "consent"
            ? { "x-papers-resource-grants": resourceSelection || "null" }
            : {}),
        },
      };
      const result =
        mode === "organization"
          ? await oauthFlowClient.oauth2.continue({
              postLogin: true,
              fetchOptions,
            })
          : await oauthFlowClient.oauth2.consent({
              accept,
              scope: scopes.join(" "),
              fetchOptions,
            });
      if (result.error)
        throw new Error(result.error.message ?? "Authorization failed");
      if (!result.data?.url)
        throw new Error(
          "Authorization did not return a destination. Start again from your agent.",
        );
      const destination = new URL(result.data.url, window.location.origin);
      if (
        mode === "organization" &&
        destination.origin === window.location.origin
      )
        destination.searchParams.set("papers_org", organizationId);
      window.location.href = destination.href;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authorization failed");
      setBusy(false);
    }
  }
  return (
    <div className="auth-shell">
      <aside className="auth-aside">
        <Brand />
        <h1>Connect your agent.</h1>
        <p>
          You choose the workspace and permissions. Your policies still apply to
          every action.
        </p>
      </aside>
      <main className="auth-main">
        <div style={{ width: "100%", maxWidth: 460 }}>
          <h1>
            {mode === "organization"
              ? "Choose a workspace"
              : `Connect ${clientName}`}
          </h1>
          {loading ? (
            <p>Loading authorization…</p>
          ) : (
            <>
              <p style={{ margin: "20px 0" }}>
                Authorize <strong>{clientName}</strong> to access the workspace
                shown below.
              </p>
              <div className="field">
                <label htmlFor="oauth-org">Workspace</label>
                <select
                  id="oauth-org"
                  value={organizationId}
                  onChange={(event) => {
                    setOrganizationId(event.target.value);
                    setResourceSelection("");
                  }}
                >
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </div>
              {mode === "consent" && (
                <>
                  <div className="field">
                    <label htmlFor="resourceSelection">Resource access</label>
                    <KeyResourcePicker
                      key={organizationId}
                      organizationId={organizationId}
                      value={resourceSelection}
                      onChange={value => {
                        setResourceSelection(value);
                        if (value) setScopes(current => current.filter(scope => !["agents:read", "numbers:provision"].includes(scope)));
                      }}
                    />
                    <small>
                      To change an existing connection’s resource selection,
                      revoke it in Integrations and reconnect.
                    </small>
                  </div>
                  <p>Requested permissions:</p>
                  <div style={{ display: "grid", gap: 12, margin: "20px 0" }}>
                    {(query.get("scope") ?? "")
                      .split(" ")
                      .filter(Boolean)
                      .map((scope) => (
                        <label
                          key={scope}
                          style={{
                            display: "flex",
                            gap: 10,
                            alignItems: "center",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={scopes.includes(scope)}
                            disabled={!!resourceSelection && ["agents:read", "numbers:provision"].includes(scope)}
                            onChange={(event) =>
                              setScopes((current) =>
                                event.target.checked
                                  ? [...current, scope]
                                  : current.filter((value) => value !== scope),
                              )
                            }
                          />
                          {scopeLabels[scope] ?? scope}
                        </label>
                      ))}
                  </div>
                  <p>
                    Access is limited by your workspace role and policies. You
                    can revoke the connection later.
                  </p>
                </>
              )}
              {!organizations.length && (
                <p>
                  Create a workspace in the dashboard, then restart this
                  connection.
                </p>
              )}
              {error && (
                <div className="notice error" role="alert">
                  {error}
                </div>
              )}
              <div className="row-actions" style={{ marginTop: 24 }}>
                <button
                  className="button"
                  disabled={busy || !organizationId || loading}
                  onClick={() => void submit()}
                >
                  {busy
                    ? "Continuing…"
                    : mode === "organization"
                      ? "Continue"
                      : "Allow access"}
                </button>
                {mode === "consent" && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void submit(false)}
                  >
                    Deny
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
