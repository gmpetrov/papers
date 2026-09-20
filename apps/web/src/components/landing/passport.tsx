'use client';
import { useState } from 'react';
import {
  Fingerprint,
  Mail,
  Phone,
  ShieldCheck,
  ArrowUpRight,
  CreditCard,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { CodeExample } from '@/components/design-system/code-example';
import { Stamp } from '@/components/design-system/paper';

export function Passport() {
  const [open, setOpen] = useState(false);
  return (
    <div className="passport-stage z-10">
      <div className={`passport-book ${open ? 'is-open' : ''}`}>
        <div
          className="passport-spread"
          id="passport-preview"
          aria-hidden={!open}
          inert={!open}
        >
          <section
            className="passport-code-page"
            aria-label="Passport code example"
          >
            <CodeExample
              compact
              samples={[
                {
                  label: 'Python',
                  code: `from papers import Papers
import os

with Papers(os.environ["PAPERS_API_KEY"]) as papers:
  inbox = papers.create_inbox(username="research")
  print(inbox.address)`,
                },
                {
                  label: 'TS',
                  code: `import { Papers } from
  "@papers.bot/sdk";

const papers = new Papers({
  apiKey: process.env.PAPERS_API_KEY!,
});

const inbox = await papers.inboxes.create({ username: "research" });`,
                },
                {
                  label: 'cURL',
                  code: `curl https://www.papers.bot/v1/inboxes \\
  -H "Authorization: Bearer $PAPERS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"username":"research"}'`,
                },
              ]}
            />
          </section>
          <section className="passport-page" aria-label="Agent identity page">
            <div className="passport-page-heading">Agent passport</div>
            <Fingerprint
              size={58}
              strokeWidth={1}
              className="passport-fingerprint"
            />
            <div className="passport-field">
              <small>Holder</small>
              <strong>Georges</strong>
            </div>
            <div className="passport-field">
              <small>
                <Mail size={12} /> Inbox
              </small>
              <span>georges@papers.bot</span>
            </div>
            <div className="passport-field">
              <small>
                <Phone size={12} /> Number
              </small>
              <span>+33661838314</span>
            </div>
            <div className="passport-field">
              <small>
                <CreditCard size={12} /> Payment Cards
              </small>
              <span>Give agents a way to pay</span>
            </div>
            <Stamp>Approved</Stamp>
            {/* <Link href="/login" className="passport-create">
              Create your workspace <ArrowUpRight size={14} />
            </Link> */}
            <div className="passport-mrz" aria-hidden="true">
              P&lt;BOT&lt;GEORGES&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;
              <br />
              INBOX&lt;NUMBER&lt;&lt;CARD&lt;&lt;
            </div>
          </section>
        </div>
        <button
          type="button"
          className="passport-cover"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          tabIndex={open ? -1 : 0}
          aria-hidden={open}
          aria-controls="passport-preview"
          aria-label={open ? 'Close example passport' : 'Open example passport'}
        >
          <span className="passport-cover-label">
            Infrastructure
            <br />
            for agents
          </span>
          <span className="passport-seal">
            <svg viewBox="0 0 160 160" aria-hidden="true">
              <defs>
                <path
                  id="passport-seal-type"
                  d="M 80,80 m -60,0 a 60,60 0 1,1 120,0 a 60,60 0 1,1 -120,0"
                />
              </defs>
              <text>
                <textPath href="#passport-seal-type" textLength="365">
                  PAPERS · BOT · PAPERS · BOT ·{' '}
                </textPath>
              </text>
            </svg>
            <em>p</em>
          </span>
          <span className="passport-cover-title">Papers</span>
          <span className="passport-cover-label">Agent passport · open</span>
        </button>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="passport-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="passport-preview"
      >
        {open ? 'Close' : 'Click to open'}
      </Button>
    </div>
  );
}
