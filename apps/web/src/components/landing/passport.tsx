"use client";
import { useState } from "react";
import {
  Fingerprint,
  Mail,
  Phone,
  ShieldCheck,
  ArrowUpRight,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Guilloche, Stamp } from "@/components/design-system/paper";

export function Passport() {
  const [open, setOpen] = useState(false);
  return (
    <div className="passport-stage">
      <Guilloche />
      <div className={`passport-book ${open ? "is-open" : ""}`}>
        <div
          className="passport-page"
          id="passport-preview"
          aria-hidden={!open}
          inert={!open}
        >
          <div className="passport-page-heading">
            Agent passport <span>Type P</span>
          </div>
          <Fingerprint
            size={58}
            strokeWidth={1}
            className="passport-fingerprint"
          />
          <div className="passport-field">
            <small>Holder</small>
            <strong>research-agent</strong>
          </div>
          <div className="passport-field">
            <small>
              <Mail size={12} /> Inbox
            </small>
            <span>research@papers.bot</span>
          </div>
          <div className="passport-field">
            <small>
              <Phone size={12} /> Number
            </small>
            <span>Dedicated · two-way SMS</span>
          </div>
          <div className="passport-field">
            <small>
              <ShieldCheck size={12} /> Access
            </small>
            <span>Your scopes. Your limits.</span>
          </div>
          <Stamp>Illustrative passport</Stamp>
          <Link href="/login" className="passport-create">
            Create your workspace <ArrowUpRight size={14} />
          </Link>
          <div className="passport-mrz" aria-hidden="true">
            P&lt;BOT&lt;RESEARCH&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;
            <br />
            INBOX&lt;NUMBER&lt;&lt;PAPERS&lt;&lt;
          </div>
        </div>
        <button
          type="button"
          className="passport-cover"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="passport-preview"
          aria-label={open ? "Close example passport" : "Open example passport"}
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
                  PAPERS · BOT · PAPERS · BOT ·{" "}
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
        {open ? "Close passport" : "Click to open your agent’s passport"}
      </Button>
    </div>
  );
}
