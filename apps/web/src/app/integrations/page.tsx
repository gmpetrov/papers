import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/public-page";
export const metadata: Metadata = {
  title: "Connect your tools — Papers",
  description:
    "Connect through MCP, REST, TypeScript, Python, or the Papers CLI.",
};
export default function IntegrationsPage() {
  return (
    <PublicPage
      eyebrow="INTEGRATIONS"
      title="Connect from the tools you use."
      description="The same workspace permissions apply across MCP, the API, both SDKs, and the CLI."
    >
      <div className="public-cards">
        <section>
          <h2>MCP</h2>
          <p>
            Connect a compatible remote MCP client, sign in, choose a workspace,
            and review scopes and resource access. Revoke connections in the
            dashboard.
          </p>
          <p>
            <code>https://dev.chaindesk.ai/mcp</code>
          </p>
        </section>
        <section>
          <h2>Python & TypeScript</h2>
          <p>
            Use typed clients for inboxes, messages, numbers, and SMS. Python
            supports synchronous and asynchronous workflows. Packages currently
            build from the repository; public npm and PyPI releases are pending.
          </p>
        </section>
        <section>
          <h2>REST & CLI</h2>
          <p>
            Use scoped API keys with cURL or sign in through the CLI. Discover
            permissions, poll operations, and watch events. The CLI also
            provides a local stdio MCP adapter.
          </p>
        </section>
      </div>
      <section className="public-detail">
        <h2>Claude, ChatGPT, and Grok</h2>
        <p>
          Direct client integrations are being prepared. Manual MCP setup
          depends on the client's available connection features; compatibility
          checks and directory reviews are still in progress. Papers is not
          currently published in these client directories.
        </p>
        <Link className="text-link" href="/docs">
          Open setup instructions →
        </Link>
      </section>
      <section className="public-detail">
        <h2>Start with the smallest permission set.</h2>
        <p>
          Create a workspace and inbox, then connect with read access. Add send
          permissions when your workflow needs them, and choose whether a human
          must approve each action.
        </p>
        <Link className="text-link" href="/llms.txt">
          Agent setup guide →
        </Link>
      </section>
    </PublicPage>
  );
}
