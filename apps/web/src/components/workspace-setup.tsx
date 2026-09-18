"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeExample } from "@/components/design-system/code-example";
import { PaperPanel, Stamp } from "@/components/design-system/paper";

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
  const [origin, setOrigin] = useState("https://www.papers.bot");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const inboxId = inbox?.id ?? "INBOX_ID";
  const samples = [
    {
      label: "cURL",
      code: `curl '${origin}/v1/inboxes/${encodeURIComponent(inboxId)}/messages' \\\n  -H "Authorization: Bearer $PAPERS_API_KEY"`,
    },
    {
      label: "TypeScript",
      code: `import { Papers } from "@papers.bot/sdk";

const papers = new Papers({
  apiKey: process.env.PAPERS_API_KEY!,
  baseUrl: ${JSON.stringify(origin)},
});
const page = await papers.messages.list(${JSON.stringify(inboxId)});
console.log(page.data);`,
    },
    {
      label: "Python",
      code: `import os
from papers import Papers

with Papers(os.environ["PAPERS_API_KEY"],
            base_url=${JSON.stringify(origin)}) as papers:
    page = papers.list_messages(${JSON.stringify(inboxId)})
    print(page["data"])`,
    },
    {
      label: "MCP",
      code: `${origin}/mcp

Connect with an OAuth-compatible MCP client.
Select your workspace and permissions.
Ask it to list messages for inbox ${inboxId}.`,
    },
  ];
  return (
    <PaperPanel
      title="Connect your first inbox"
      action={<Stamp>{inbox ? "Inbox ready" : "Start here"}</Stamp>}
    >
      <div className="setup-layout">
        <ol className="paper-steps">
          <li>
            <strong>{inbox ? "Your inbox is ready" : "Create an inbox"}</strong>
            <p className={inbox ? "font-mono" : ""}>
              {inbox
                ? inbox.address
                : "Choose a workspace address. No agent registration needed."}
            </p>
            {!inbox &&
              (canManage ? (
                <Button variant="outline" size="sm" onClick={onCreateInbox}>
                  Create inbox
                </Button>
              ) : (
                <p>Ask a workspace owner or admin to create an inbox.</p>
              ))}
          </li>
          <li>
            <strong>Issue a scoped key</strong>
            <p>
              Create a key with <code>inboxes:read</code> and select this inbox.
              Add send access only when needed. MCP clients can connect with
              OAuth instead.
            </p>
            {canManage ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!inbox}
                onClick={onCreateKey}
              >
                Create scoped API key
              </Button>
            ) : (
              <p>A workspace owner or admin manages API keys.</p>
            )}
          </li>
          <li>
            <strong>Read your messages</strong>
            <p>An empty result is expected until the first email arrives.</p>
          </li>
        </ol>
        <div className="min-w-0">
          <CodeExample compact samples={samples} />
          <p className="setup-install-note">
            For SDK installation and setup, follow the repository instructions
            in the quickstart.
          </p>
          <Link className="setup-quickstart" href="/docs">
            Full quickstart <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>
    </PaperPanel>
  );
}
