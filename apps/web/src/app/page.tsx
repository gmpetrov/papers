import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Mail,
  Phone,
  CreditCard,
  ShieldCheck,
  KeyRound,
  Repeat2,
  ScrollText,
} from 'lucide-react';
import { Brand } from '@/components/brand';
import { PublicNav } from '@/components/public-page';
import { buttonVariants } from '@/components/ui/button';
import { Passport } from '@/components/landing/passport';
import { RotatingHeroTitle } from '@/components/landing/rotating-hero-title';
import { CodeExample } from '@/components/design-system/code-example';
import { Guilloche, Stamp } from '@/components/design-system/paper';

const credentials = [
  {
    title: 'An inbox of its own.',
    label: 'Inbox',
    icon: Mail,
    href: '/email',
    description: 'Send, receive, and reply from one persistent address.',
    details: [
      'Give your agent a dedicated address, owned by your workspace.',
      'Keep replies, conversation history, and attachments together.',
      'Bring new messages into your workflow with webhooks or polling.',
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
    description: 'A dedicated number for two-way text conversations.',
    details: [
      'A dedicated number, with availability and activation requirements shown before you order.',
      'Send and receive text messages through the same API as email.',
      'Release it when you no longer need it.',
    ],
    facts: [
      ['Number', 'Dedicated to your workspace'],
      ['Availability', 'Check before ordering'],
      ['Channels', 'SMS'],
    ],
  },
  {
    title: 'A card of its own.',
    label: 'Credit Card',
    icon: CreditCard,
    href: '/email',
    description: 'A way to pay. Credit cards are on the roadmap.',
    details: [
      'A payment method for the tasks your agent takes on.',
      'Card issuing and purchases are not available yet.',
      'Build your workflow now with email and SMS.',
    ],
    facts: [
      ['Status', 'Planned'],
      ['Launch', 'Not yet announced'],
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
            <RotatingHeroTitle />
            <p>
              Papers.bot is the identity API for AI agents. Every agent gets a
              real inbox, a real number, and a real card, the way a person gets
              them from Gmail, a carrier, and a bank.
            </p>
            <div className="credential-summary credential-ledger">
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
                Create your workspace <ArrowRight />
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

        <section
          className="papers-tool-strip papers-tools-folded"
          aria-labelledby="tools-heading"
        >
          <h2 id="tools-heading" className="tools-title-simple">
            works with your favorite tools
          </h2>
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
              Their own tools.
              <br />
              <em>Your workspace.</em>
            </h2>
            <p>
              Start with email and SMS. Credit cards are on the roadmap. You own
              the resources and decide what your agent can do.
            </p>
          </div>
          <div className="credential-grid">
            {credentials.map(
              ({ title, label, icon: Icon, details, facts, href }) => (
                <article
                  className="credential-paper"
                  key={label}
                  id={label === 'Credit Card' ? 'credit-card' : undefined}
                >
                  <header>
                    <span>
                      <Icon size={18} />
                      {label}
                    </span>
                    <Stamp>
                      {label === 'Credit Card' ? 'Planned' : 'Ready for agents'}
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
                      {label === 'Credit Card'
                        ? 'Start with an inbox'
                        : `Explore ${label.toLowerCase()}`}{' '}
                      <ArrowUpRight size={14} />
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
              From setup
              <br />
              <em>to first message.</em>
            </h2>
            <ol className="paper-steps">
              <li>
                <h3>Create your workspace</h3>
                <p>
                  Keep your inboxes, numbers, and team in one place. Issue a key
                  with only the access your agent needs.
                </p>
              </li>
              <li>
                <h3>Give your agent an address</h3>
                <p>
                  Create an inbox with one API call. Add a phone number when you
                  need SMS, after checking availability and activation
                  requirements.
                </p>
              </li>
              <li>
                <h3>Connect and start a conversation</h3>
                <p>
                  Use MCP with OAuth, the TypeScript or Python SDK, the CLI, or
                  HTTP. Send your first message from your own workflow.
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
              Room to act.
              <br />
              <em>Limits you set.</em>
            </h2>
            <p>
              Delegate email and SMS without handing over every permission.
              Choose the access, review requests, and keep the conversation
              history.
            </p>
          </div>
          <div className="controls-grid">
            {[
              [
                KeyRound,
                'Scopes',
                'Share only what is needed',
                'Choose the inboxes, numbers, and actions each key can access. Add send access only when needed.',
              ],
              [
                ShieldCheck,
                'Approvals',
                'Keep a say in what happens',
                'Review the exact request. Approving permits one matching retry; it does not execute the action.',
              ],
              [
                Repeat2,
                'Idempotency',
                'Retry without sending twice',
                'Reuse the key, get the same result. A different payload on the same key returns a conflict.',
              ],
              [
                ScrollText,
                'History',
                'Keep the full conversation',
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
            <p>
              Start with an inbox. Add a number. A card. Make your agent fully
              autonomous.
            </p>
          </div>
          <div className="papers-actions">
            <Link href="/login" className={buttonVariants({ size: 'lg' })}>
              Start for free <ArrowRight />
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
          <p>Email and SMS for agents. Credit cards on the roadmap.</p>
        </div>
        <div>
          <strong>Papers</strong>
          <Link href="/email">Inbox</Link>
          <Link href="/phone">Number</Link>
          <Link href="#credit-card">Credit Card · Planned</Link>
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
          INBOX&lt;NUMBER&lt;CREDIT&lt;CARD&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;
        </div>
      </footer>
    </div>
  );
}
