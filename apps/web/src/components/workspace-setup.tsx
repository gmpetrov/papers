"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

const clients = ["cURL", "TypeScript", "Python", "MCP"] as const;
type Client = (typeof clients)[number];
export function WorkspaceSetup({
  inbox,
  canManage,
  onCreateInbox,
  onCreateKey,
}: {
  inbox?: { id: string; address?: string };
  canManage: boolean;
  onCreateInbox: () => void;
  onCreateKey: () => void;
}) {
  const [client, setClient] = useState<Client>("cURL");
  const [origin, setOrigin] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const inboxId = inbox?.id ?? "INBOX_ID";
  const base = origin || "https://YOUR_PAPERS_HOST";
  const snippets: Record<Client, string> = {
    cURL: `curl '${base}/v1/inboxes/${encodeURIComponent(inboxId)}/messages' \\\n  -H "Authorization: Bearer $PAPERS_API_KEY"`,
    TypeScript: `import { Papers } from "@agentinfra/sdk";

const papers = new Papers({
  apiKey: process.env.PAPERS_API_KEY!,
  baseUrl: ${JSON.stringify(base)},
});
const page = await papers.messages.list(${JSON.stringify(inboxId)});
console.log(page.data);`,
    Python: `import os
from papers import Papers

with Papers(os.environ["PAPERS_API_KEY"], base_url=${JSON.stringify(base)}) as papers:
    page = papers.list_messages(${JSON.stringify(inboxId)})
    print(page["data"])`,
    MCP: `${base}/mcp`,
  };
  return (
    <section className="panel" aria-labelledby="workspace-setup-title">
      <div className="panel-head">
        <h2 id="workspace-setup-title">Connect your first inbox</h2>
        <Link href="/docs">Full quickstart ↗</Link>
      </div>
      <div className="panel-body">
        <ol style={{ paddingLeft: 22, display: "grid", gap: 20 }}>
          <li>
            <strong>{inbox ? "Your inbox is ready" : "Create an inbox"}</strong>
            <p>
              {inbox
                ? inbox.address
                : "Choose a workspace address. No agent registration is needed."}
            </p>
            {!inbox &&
              (canManage ? (
                <button
                  className="button secondary small"
                  onClick={onCreateInbox}
                >
                  Create inbox
                </button>
              ) : (
                <p>Ask a workspace owner or admin to create an inbox.</p>
              ))}
          </li>
          <li>
            <strong>Choose how to connect</strong>
            <p>
              For API access, create a key with <code>inboxes:read</code> and
              select this inbox. Set the key as <code>PAPERS_API_KEY</code> in
              your local environment. Add send access only when needed.
            </p>
            {canManage ? (
              <button
                className="button secondary small"
                onClick={onCreateKey}
                disabled={!inbox}
              >
                Create scoped API key
              </button>
            ) : (
              <p>A workspace owner or admin manages API keys.</p>
            )}
            <p>
              For OAuth-capable MCP clients, sign in through the connection flow
              and select your workspace and permissions.
            </p>
          </li>
          <li>
            <strong>Read your messages</strong>
            <div className="field" style={{ marginTop: 16 }}>
              <label htmlFor="setup-client">Connection method</label>
              <select
                id="setup-client"
                value={client}
                onChange={(e) => {
                  setClient(e.target.value as Client);
                  setCopyStatus("");
                }}
              >
                {clients.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </div>
            {client === "MCP" ? (
              <p>
                Use this URL in a compatible remote MCP client. After
                connecting, ask it to list messages for inbox{" "}
                <code>{inboxId}</code>. Client directory listings are not yet
                available.
              </p>
            ) : (
              <p>
                The example reads message summaries. An empty result is expected
                until an email arrives.
              </p>
            )}
            {(client === "TypeScript" || client === "Python") && (
              <p>
                The SDK currently builds from this repository. See the{" "}
                <Link href="/docs">installation instructions</Link>; public
                package releases are pending.
              </p>
            )}
            <pre className="code-block" style={{ margin: "16px 0" }}>
              <code>{snippets[client]}</code>
            </pre>
            <button
              className="button secondary small"
              disabled={!origin}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(snippets[client]);
                  setCopyStatus("Copied");
                } catch {
                  setCopyStatus(
                    "Copy unavailable. Select and copy the example above.",
                  );
                }
              }}
            >
              Copy {client === "MCP" ? "MCP URL" : "example"}
            </button>
            <p role="status">{copyStatus}</p>
          </li>
        </ol>
      </div>
    </section>
  );
}
