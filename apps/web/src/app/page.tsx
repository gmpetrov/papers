import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Mail,
  Phone,
  ShieldCheck,
  KeyRound,
  Repeat2,
  ScrollText,
} from 'lucide-react';
import { Brand } from '@/components/brand';
import { PublicNav } from '@/components/public-page';
import { buttonVariants } from '@/components/ui/button';
import { Passport } from '@/components/landing/passport';
import { CodeExample } from '@/components/design-system/code-example';
import { Guilloche, Stamp } from '@/components/design-system/paper';

const credentials = [
  {
    title: 'An inbox of its own.',
    label: 'Inbox',
    icon: Mail,
    href: '/email',
    description: 'A real email address. Sends, receives, keeps history.',
    details: [
      'A persistent address for your workspace.',
      'Send, receive, and reply. Conversation history and attachments included.',
      'Incoming mail through signed webhooks or a simple poll.',
    ],
    facts: [
      ['Address', 'research@papers.bot'],
      ['History', 'Persistent conversations'],
      ['Delivery', 'Webhook · poll'],
    ],
  },
  {
    title: 'A direct line.',
    label: 'Number',
    icon: Phone,
    href: '/phone',
    description: 'A dedicated phone number. Two-way SMS.',
    details: [
      'A dedicated number, with availability and activation requirements shown before you order.',
      'Two-way SMS through the same API as email.',
      'Release it when you no longer need it.',
    ],
    facts: [
      ['Number', 'Dedicated to your workspace'],
      ['Availability', 'Check before ordering'],
      ['Channels', 'SMS'],
    ],
  },
  {
    title: 'Access, on your terms.',
    label: 'Control',
    icon: ShieldCheck,
    href: '/integrations',
    description: 'Scoped access. Limits and approvals you set.',
    details: [
      'Grant access to the resources and actions an agent needs.',
      'Set workspace limits and review requests that need approval.',
      'Connect through MCP, SDKs, a CLI, or HTTP.',
    ],
    facts: [
      ['Access', 'Scoped API keys · OAuth'],
      ['Limits', 'Set by your workspace'],
      ['Approvals', 'Review before retry'],
    ],
  },
];
const samples = [
  {
    label: 'TypeScript',
    code: `import { Papers } from "@papers.bot/sdk";

const papers = new Papers({
  apiKey: process.env.PAPERS_API_KEY!,
  baseUrl: "https://www.papers.bot",
});

const inbox = await papers.inboxes.create(
  { name: "Research", localPart: "research" },
  { idempotencyKey: "research-inbox-001" }
);

console.log(inbox.address);`,
  },
  {
    label: 'Python',
    code: `import os
from papers import Papers

with Papers(
    os.environ["PAPERS_API_KEY"],
    base_url="https://www.papers.bot",
) as papers:
    inbox = papers.create_inbox(
        name="Research", local_part="research",
        idempotency_key="research-inbox-001",
    )
    print(inbox.address)`,
  },
  {
    label: 'cURL',
    code: `curl https://www.papers.bot/v1/inboxes \\
  -H "Authorization: Bearer $PAPERS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: research-inbox-001" \\
  -d '{"name":"Research","localPart":"research"}'`,
  },
  {
    label: 'MCP',
    code: `https://www.papers.bot/mcp

Connect with an OAuth-compatible MCP client.
Choose your workspace and review its permissions.
Then ask your agent to create an inbox.`,
  },
];
export default function Landing() {
  return (
    <div className="papers-landing">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <PublicNav />
      <main id="main-content">
        <section className="papers-hero">
          <Guilloche className="hero-guilloche" />
          <div className="papers-hero-copy">
            <h1>
              Papers for
              <br />
              <em>AI agents</em>
            </h1>
            <p>
              Papers.bot is the identity API for AI agents. Every agent gets a
              real inbox, a real number, and a real card, the way a person gets
              them from Gmail, a carrier, and a bank.
            </p>
            <div className="credential-summary">
              {credentials.map(({ label, icon: Icon, description }) => (
                <div key={label}>
                  <strong>
                    <Icon size={17} />
                    {label}
                  </strong>
                  <p>{description}</p>
                </div>
              ))}
            </div>
            <div className="papers-actions">
              <Link href="/login" className={buttonVariants({ size: 'lg' })}>
                Start for free <ArrowRight />
              </Link>
              <Link
                href="/docs"
                className={buttonVariants({ variant: 'link', size: 'lg' })}
              >
                Read the docs
              </Link>
            </div>
          </div>
          <Passport />
        </section>
        <section className="papers-tool-strip" aria-labelledby="tools-heading">
          <h2 id="tools-heading">works with your favorite tools</h2>
          <ul className="papers-connections">
            {[
              ['Claude Code', 'claudecode'],
              ['Codex', 'codex'],
              ['Cursor', 'cursor'],
              ['OpenClaw', 'openclaw'],
              ['Replit', 'replit'],
              ['Lovable', 'lovable'],
              ['Vercel', 'vercel'],
              ['Devin', 'devin'],
              ['Hermes', 'hermesagent'],
              ['Grok Bot', 'grok'],
            ].map(([name, logo]) => (
              <li key={name} title={name} data-tool={logo}>
                <Image
                  src={`/logos/${logo}.svg`}
                  alt={name}
                  width={32}
                  height={32}
                />
              </li>
            ))}
          </ul>
        </section>
        <section className="papers-section" id="papers">
          <div className="papers-section-intro">
            <h2>
              Real-world tools.
              <br />
              <em>Now for an agent.</em>
            </h2>
            <p>
              Everything your agent needs to start a conversation, with the
              access and approvals you control.
            </p>
          </div>
          <div className="credential-grid">
            {credentials.map(
              ({ title, label, icon: Icon, details, facts, href }) => (
                <article className="credential-paper" key={label}>
                  <header>
                    <span>
                      <Icon size={18} />
                      {label}
                    </span>
                    <Stamp>
                      {label === 'Control'
                        ? 'On your terms'
                        : 'Ready for agents'}
                    </Stamp>
                  </header>
                  <div className="credential-content">
                    <h3>{title}</h3>
                    <ul>
                      {details.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                    <Link href={href}>
                      Explore {label.toLowerCase()} <ArrowUpRight size={14} />
                    </Link>
                  </div>
                  <dl>
                    {facts.map(([name, value]) => (
                      <div key={name}>
                        <dt>{name}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              ),
            )}
          </div>
        </section>
        <section className="papers-section papers-how" id="quickstart">
          <div>
            <h2>
              A few lines.
              <br />
              <em>Real papers.</em>
            </h2>
            <ol className="paper-steps">
              <li>
                <h3>Create a workspace, issue a scoped key</h3>
                <p>
                  Keys carry only the scopes you grant. No agent registration
                  required.
                </p>
              </li>
              <li>
                <h3>Issue the papers</h3>
                <p>
                  One call per resource, with an idempotency key so retries
                  never create duplicates.
                </p>
              </li>
              <li>
                <h3>Hand them to your agent</h3>
                <p>
                  Connect through MCP with OAuth, or use the SDKs, the CLI, or
                  plain HTTP.
                </p>
              </li>
            </ol>
          </div>
          <div className="landing-code">
            <CodeExample samples={samples} />
            <div className="code-links">
              <Link href="/openapi.json">
                OpenAPI spec <ArrowUpRight size={13} />
              </Link>
              <Link href="/docs">
                Agent setup guide <ArrowUpRight size={13} />
              </Link>
            </div>
          </div>
        </section>
        <section className="papers-section papers-controls">
          <div className="papers-section-intro">
            <h2>
              Real papers,
              <br />
              <em>real limits.</em>
            </h2>
            <p>
              Agents act in the world. Give them room to work, with scopes,
              approvals, and a record of their conversations.
            </p>
          </div>
          <div className="controls-grid">
            {[
              [
                KeyRound,
                'Scopes',
                'Least privilege by default',
                'Choose the inboxes, numbers, and actions each key can access. Add send access only when needed.',
              ],
              [
                ShieldCheck,
                'Approvals',
                'A human in the loop',
                'Review the exact request. Approving permits one matching retry; it does not execute the action.',
              ],
              [
                Repeat2,
                'Idempotency',
                'Retries that never double-send',
                'Reuse the key, get the same result. A different payload on the same key returns a conflict.',
              ],
              [
                ScrollText,
                'History',
                'Every conversation on the record',
                'Keep sent and received messages together. Signed webhooks bring events into your workflow.',
              ],
            ].map(([Icon, label, title, text]) => {
              const I = Icon as typeof Mail;
              return (
                <article key={String(label)}>
                  <div>
                    <I size={18} />
                    <span>{String(label)}</span>
                  </div>
                  <h3>{String(title)}</h3>
                  <p>{String(text)}</p>
                </article>
              );
            })}
          </div>
        </section>
        <section className="papers-final">
          <Guilloche />
          <div>
            <Stamp>Ready to issue</Stamp>
            <h2>
              Give your agent
              <br />
              <em>its papers.</em>
            </h2>
            <p>Your workspace. Your permissions. Their next conversation.</p>
          </div>
          <div className="papers-actions">
            <Link href="/login" className={buttonVariants({ size: 'lg' })}>
              Create your workspace <ArrowRight />
            </Link>
            <Link href="/docs">
              Read the docs <ArrowUpRight size={15} />
            </Link>
          </div>
        </section>
      </main>
      <footer className="papers-footer">
        <div>
          <Brand />
          <p>Infrastructure for independent agents.</p>
        </div>
        <div>
          <strong>Papers</strong>
          <Link href="/email">Inbox</Link>
          <Link href="/phone">Number</Link>
          <Link href="/integrations">Integrations</Link>
        </div>
        <div>
          <strong>Developers</strong>
          <Link href="/docs">Documentation</Link>
          <Link href="/openapi.json">OpenAPI spec</Link>
          <Link href="/integrations">MCP connections</Link>
        </div>
        <div>
          <strong>Workspace</strong>
          <Link href="/pricing">Pricing</Link>
          <Link href="/login">Sign in</Link>
          <Link href="/dashboard">Dashboard</Link>
        </div>
        <div className="footer-mrz" aria-hidden="true">
          P&lt;BOT&lt;PAPERS&lt;&lt;AGENT&lt;RESEARCH&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;
          <br />
          INBOX&lt;NUMBER&lt;PERMISSIONS&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;
        </div>
      </footer>
    </div>
  );
}
