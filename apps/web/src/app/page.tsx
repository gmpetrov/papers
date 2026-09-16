import Link from "next/link";
import {
  ArrowUpRight,
  ArrowRight,
  Mail,
  Terminal,
  Phone,
  ShieldCheck,
  Workflow,
  ChevronRight,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { PublicNav } from "@/components/public-page";
export default function Landing() {
  return (
    <main className="landing">
      <PublicNav />
      <section className="hero">
        <div className="eyebrow">
          <span className="live-dot" /> INFRASTRUCTURE FOR THE AGENT ERA
        </div>
        <h1>
          Your agents.
          <br />
          Out in the <em>world.</em>
        </h1>
        <p className="hero-copy">
          Give your AI agents an inbox, a phone number,
          <br className="desktop" /> and a direct line to getting things done.
        </p>
        <div className="hero-actions">
          <Link href="/login" className="button">
            Give your agent an inbox <ArrowRight size={17} />
          </Link>
          <Link href="/docs" className="text-link">
            Read the docs <ArrowUpRight size={15} />
          </Link>
        </div>
        <div className="hero-foot">
          Built for developers. Ready for any agent.
        </div>
        <div className="hero-grid">
          <div className="orbit-label top">
            <span />
            CONNECTED TO THE REAL WORLD
          </div>
          <div className="identity-card">
            <div className="card-heading">
              <span className="agent-avatar">
                <Workflow size={23} />
              </span>
              <div>
                <b>Research assistant</b>
                <small>Workspace inbox</small>
              </div>
              <span className="badge green">Connected</span>
            </div>
            <div className="identity-row">
              <Mail size={17} />
              <div>
                <small>DEDICATED INBOX</small>
                <b>research@papers.bot</b>
              </div>
              <span className="live-dot" />
            </div>
            <div className="identity-row">
              <Phone size={17} />
              <div>
                <small>PHONE NUMBERS</small>
                <b>One number. Every conversation.</b>
              </div>
              <span className="badge">SMS</span>
            </div>
            <div className="identity-footer">
              <ShieldCheck size={14} /> Your permissions. Your agent's world.
            </div>
          </div>
          <div className="code-float">
            <span className="code-label">A FEW LINES. REAL CAPABILITIES.</span>
            <pre>{`const inbox = await papers.inboxes.create(
  { name: "Research", localPart: "research" },
  { idempotencyKey: "research-inbox-001" }
);`}</pre>
            <div>
              <span className="live-dot" /> One API. Infinite possibilities.
            </div>
          </div>
          <div className="orbit-label bottom">
            01 — EMAIL &nbsp; 02 — PHONE &nbsp; 03 — WHATEVER'S NEXT
          </div>
        </div>
      </section>
      <section id="connect" className="connect-strip">
        <span>CONNECT THROUGH MCP & API</span>
        <b>Claude</b>
        <b>ChatGPT</b>
        <b>Grok</b>
        <b className="mono">Python</b>
        <b className="mono">TypeScript</b>
        <b className="mono">cURL</b>
      </section>
      <section id="infrastructure" className="feature-section">
        <div className="section-intro">
          <div className="eyebrow">SMALL PRIMITIVES. BIG POSSIBILITIES.</div>
          <h2>
            Everything an agent needs
            <br />
            to start a conversation.
          </h2>
          <p>
            Real communication tools, with the control
            <br />
            and visibility your team needs.
          </p>
        </div>
        <div className="feature-grid">
          <article>
            <Mail />
            <span className="feature-number">01</span>
            <h3>An inbox of their own.</h3>
            <p>
              Send, receive, and reply. Persistent email addresses and
              conversation history, designed for software.
            </p>
            <Link href="/email">
              Explore email <ArrowUpRight size={15} />
            </Link>
          </article>
          <article>
            <Phone />
            <span className="feature-number">02</span>
            <h3>A direct line.</h3>
            <p>
              Dedicated phone numbers and two-way SMS, with availability and
              activation requirements shown before you order.
            </p>
            <Link href="/phone">
              Explore phone numbers <ArrowUpRight size={15} />
            </Link>
          </article>
          <article>
            <Terminal />
            <span className="feature-number">03</span>
            <h3>Speaks your language.</h3>
            <p>
              A consistent API across your tools. Connect with MCP, SDKs, a CLI,
              or a simple HTTP request.
            </p>
            <Link href="/integrations">
              Start integrating <ArrowUpRight size={15} />
            </Link>
          </article>
        </div>
      </section>
      <section className="bottom-cta">
        <div>
          <span className="eyebrow">LET'S GET TO WORK</span>
          <h2>
            The world is waiting
            <br />
            for your agents.
          </h2>
        </div>
        <Link className="button" href="/login">
          Create your workspace <ArrowRight size={17} />
        </Link>
      </section>
      <footer>
        <Brand />
        <span>Infrastructure for independent agents.</span>
        <Link href="/docs">
          Documentation <ChevronRight size={14} />
        </Link>
      </footer>
    </main>
  );
}
