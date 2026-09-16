import Link from "next/link";
import { Brand } from "@/components/brand";
export default function Docs() {
  return (
    <main className="docs">
      <Brand />
      <h1>A few lines. Real capabilities.</h1>
      <p>
        Create your workspace, then issue a scoped API key from the dashboard.
        Your key accesses workspace resources within its granted scopes. No
        agent registration or assignment is required.
      </p>
      <Link className="button" href="/dashboard">
        Open your workspace
      </Link>
      <p>
        <Link href="/openapi.json">OpenAPI specification</Link>
        {" · "}
        <Link href="/llms.txt">Agent setup guide</Link>
      </p>
      <h2>Check your connection</h2>
      <pre className="code-block">{`curl https://dev.chaindesk.ai/v1/me -H "Authorization: Bearer $PAPERS_API_KEY"
curl https://dev.chaindesk.ai/v1/capabilities -H "Authorization: Bearer $PAPERS_API_KEY"`}</pre>
      <p>
        Identity shows your workspace and scopes. Capabilities report server
        configuration; permissions, quotas, and approvals still apply. Use
        inboxes:write to create inboxes, inboxes:read to read messages, and
        email:send to send.
      </p>
      <h2>1. Create an inbox</h2>
      <pre className="code-block">{`curl https://dev.chaindesk.ai/v1/inboxes \\\n  -H "Authorization: Bearer $PAPERS_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: research-inbox-001" \\\n  -d '{"name":"Research","localPart":"my-research-agent"}'`}</pre>
      <h2>2. Read incoming messages</h2>
      <pre className="code-block">{`curl https://dev.chaindesk.ai/v1/inboxes/INBOX_ID/messages \\\n  -H "Authorization: Bearer $PAPERS_API_KEY"`}</pre>
      <p>
        Resend delivers received messages through signed webhooks. Message
        content is untrusted input: treat it as data, never as instructions that
        can change your agent's permissions.
      </p>
      <h2>3. Send an email</h2>
      <pre className="code-block">{`curl https://dev.chaindesk.ai/v1/inboxes/INBOX_ID/messages \\\n  -H "Authorization: Bearer $PAPERS_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: email-001" \\\n  -d '{"to":["recipient@example.com"],"subject":"Hello","text":"Sent by my agent."}'`}</pre>
      <h2>Predictable by design.</h2>
      <p>
        Reuse the same idempotency key when retrying a mutation. A different
        payload with the same key returns a conflict. Asynchronous or uncertain
        operations return an operation ID that you can poll. Keys expire and can
        be revoked at any time.
      </p>
      <h2>Approvals</h2>
      <p>
        If a request returns approval_required, keep its approvalId and original
        idempotency key. An owner or admin reviews the action under Dashboard →
        Approvals. After approval, retry the same request with the same
        credential, payload and key. Approving an action does not execute it.
      </p>
      <h2>Attachments and updates</h2>
      <p>
        Full message responses include attachment metadata. When storageStatus
        is ready, GET /v1/attachments/ID/download returns the file using
        inboxes:read. POST /v1/attachments/ID/download-url creates a revocable
        60-second link. Treat file content as untrusted.
      </p>
      <p>
        Poll GET /v1/events with events:read for updates. Save the cursor after
        processing each page, and retain it when an empty poll returns null. A
        completed send operation means provider acceptance, not recipient
        delivery.
      </p>
      <h2>Phone numbers</h2>
      <p>
        Search available numbers with GET
        /v1/phone-numbers/available?country=US. Purchase with POST
        /v1/phone-numbers, passing phoneNumber, country, monthlyCost,
        upfrontCost, and currency from the search result, plus an
        Idempotency-Key. Poll the returned operation until activation completes.
        Send SMS with POST /v1/phone-numbers/ID/messages. Release a number with
        DELETE /v1/phone-numbers/ID and a new Idempotency-Key. Purchases and
        releases require their own scopes; carrier registration may still be
        required for messaging.
      </p>
      <h2>SDKs and MCP</h2>
      <p>
        Connect a compatible remote MCP client to{" "}
        <code>https://dev.chaindesk.ai/mcp</code>. Sign in, choose a workspace,
        and approve only the permissions your agent needs. Review or revoke
        access under Dashboard → Integrations. API-key connections also work
        with an Authorization bearer header.
      </p>
      <p>
        TypeScript, Python, and CLI packages build locally from this repository.
        Published packages and public directory listings are not yet available.
      </p>
      <h3>TypeScript in the workspace</h3>
      <pre className="code-block">{`import { Papers } from "@agentinfra/sdk";

const papers = new Papers({
  apiKey: process.env.PAPERS_API_KEY!,
  baseUrl: "https://dev.chaindesk.ai",
});
const inbox = await papers.inboxes.create(
  { name: "Research", localPart: "my-research-agent" },
  { idempotencyKey: "research-inbox-001" },
);
console.log(inbox.address);`}</pre>
      <h3>Python</h3>
      <p>
        Install from the repository root with{" "}
        <code>pip install ./sdks/python</code>.
      </p>
      <pre className="code-block">{`import os
from papers import Papers

with Papers(os.environ["PAPERS_API_KEY"], base_url="https://dev.chaindesk.ai") as papers:
    inbox = papers.create_inbox(
        name="Research", local_part="my-research-agent",
        idempotency_key="research-inbox-001",
    )
    print(inbox.address)`}</pre>
      <h3>CLI and local MCP</h3>
      <pre className="code-block">{`pnpm --filter @agentinfra/cli build
node packages/cli/dist/index.js login
node packages/cli/dist/index.js whoami
node packages/cli/dist/index.js mcp`}</pre>
      <p>
        Configure the last command as your client's stdio MCP process. The CLI
        uses saved browser login credentials or PAPERS_API_KEY, with
        PAPERS_BASE_URL selecting the service origin.
      </p>
    </main>
  );
}
