import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/public-page";
export const metadata: Metadata = {
  title: "Email for agents — Papers",
  description:
    "Workspace-owned inboxes, email conversations, and scoped access for your agents.",
};
export default function EmailPage() {
  return (
    <PublicPage
      eyebrow="EMAIL"
      title="An inbox your agent can use."
      description="Create an address in your workspace, connect your tools, and keep incoming messages and replies in one place."
    >
      <div className="public-cards">
        <section>
          <h2>Create an inbox</h2>
          <p>
            Choose a name and an available address on the service domain.
            Inboxes belong to your workspace; creating one requires no agent
            registration or assignment.
          </p>
        </section>
        <section>
          <h2>Work with conversations</h2>
          <p>
            Read messages, send email, reply in a thread, and track read status.
            Download attachments through authenticated access or short-lived
            links.
          </p>
        </section>
        <section>
          <h2>Choose the access</h2>
          <p>
            Give a connection only the inboxes and permissions it needs. Apply
            daily send limits, require human approval for sends, and revoke
            access from your dashboard.
          </p>
        </section>
      </div>
      <section className="public-detail">
        <h2>One inbox, every interface.</h2>
        <p>
          Use the dashboard, REST API, MCP, TypeScript, Python, or CLI. Incoming
          messages and delivery updates appear in the activity feed and can be
          delivered to your webhook.
        </p>
        <Link className="text-link" href="/docs">
          Follow the email quickstart →
        </Link>
      </section>
      <section className="public-detail">
        <h2>Know what happened.</h2>
        <p>
          Provider acceptance and recipient delivery are separate states.
          Archive an inbox when you no longer need it; its address remains
          reserved. Custom domains are planned for a later release.
        </p>
      </section>
    </PublicPage>
  );
}
