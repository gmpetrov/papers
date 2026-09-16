"use client";
import Link from "next/link";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { authClient } from "@agentinfra/auth/client";
import { KeyResourcePicker } from "./key-resource-picker";
import { resourceGrantsSchema } from "@agentinfra/contracts";
import { ConnectionLimits } from "./connection-limits";
import { InboxLifecycle } from "./inbox-lifecycle";
import { PhoneDashboard } from "./phone-dashboard";
import { Brand } from "./brand";
import { TeamMembers } from "./team-members";
import { WebhookSettings } from "./webhook-settings";
import { ApprovalReview } from "./approval-review";
import { WorkspaceUsage } from "./workspace-usage";
import { WorkspaceSetup } from "./workspace-setup";
import { WorkspaceLimits } from "./workspace-limits";
import { EmailAttachments } from "./email-attachments";
import type { AttachmentInfo } from "@agentinfra/contracts";
import {
  LayoutDashboard,
  Mail,
  Phone,
  KeyRound,
  Webhook,
  Plug,
  Settings,
  ArrowUpRight,
  Plus,
  ArrowRight,
  ArrowLeft,
  LogOut,
  BookOpen,
  X,
  ShieldCheck,
  Copy,
  Terminal,
  Activity,
  Users,
  Send,
} from "lucide-react";
type Row = {
  resourceGrants?: { inboxIds: string[]; phoneNumberIds: string[] } | null;
  dailyEmailLimit?: number | null;
  dailySmsLimit?: number | null;
  dailyInboxLimit?: number | null;
  dailyNumberLimit?: number | null;
  attachments?: AttachmentInfo[];
  id: string;
  userId?: string;
  teamId?: string;
  unread?: boolean;
  name?: string;
  description?: string;
  address?: string;
  status?: string;
  prefix?: string;
  subject?: string;
  from?: string;
  text?: string;
  direction?: string;
  createdAt?: string | Date;
  scopes?: string[];
  role?: string;
  email?: string;
  user?: { name: string; email: string };
  _count?: { messages: number };
  revokedAt?: string | null;
};
type Props = {
  user: { id: string; name: string; email: string; role: string };
  organizations: { id: string; name: string; role: string }[];
  activeOrganizationId: string | null;
  impersonatedBy: string | null;
  section: string;
};
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const r = await fetch(`/v1${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(method === "POST"
        ? { "Idempotency-Key": idempotencyKey ?? crypto.randomUUID() }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message ?? "Request failed");
  return d;
}
const nav = [
  ["overview", "Overview", LayoutDashboard],
  ["inboxes", "Inboxes", Mail],
  ["numbers", "Phone numbers", Phone],
  ["api-keys", "API keys", KeyRound],
  ["integrations", "Integrations", Plug],
  ["approvals", "Approvals", ShieldCheck],
  ["usage", "Usage", Activity],
  ["settings", "Organization", Settings],
] as const;
const nameSchema = z.object({ name: z.string().min(1).max(80) });
function NameForm({
  label,
  onSave,
}: {
  label: string;
  onSave: (v: { name: string }) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(nameSchema) });
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={handleSubmit(async (v) => {
        try {
          await onSave(v);
        } catch (e) {
          setError((e as Error).message);
        }
      })}
    >
      <div className="field">
        <label htmlFor="resource-name">{label}</label>
        <input
          id="resource-name"
          autoFocus
          placeholder="e.g. Research assistant"
          {...register("name")}
        />
        <small>{errors.name?.message}</small>
      </div>
      {error && <div className="notice error">{error}</div>}
      <button className="button full" disabled={isSubmitting}>
        {isSubmitting ? "Creating…" : "Create"}
      </button>
    </form>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close" onClick={close}>
            <X size={19} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function Dashboard({
  user,
  organizations,
  activeOrganizationId,
  impersonatedBy,
  section,
}: Props) {
  const router = useRouter();
  const [inboxes, setInboxes] = useState<Row[]>([]);
  const [inboxCursor, setInboxCursor] = useState<string | null>(null);
  const [loadingInboxes, setLoadingInboxes] = useState(false);
  const inboxGeneration = useRef(0);
  const [keys, setKeys] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [messages, setMessages] = useState<Row[]>([]);
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const messageGeneration = useRef(0);
  const [message, setMessage] = useState<Row | null>(null);
  const [token, setToken] = useState("");
  const [members, setMembers] = useState<Row[]>([]);
  const [teams, setTeams] = useState<Row[]>([]);
  const [invitations, setInvitations] = useState<Row[]>([]);
  const [connections, setConnections] = useState<
    {
      id: string;
      scopes: string[];
      oauthclient: { name: string | null; clientId: string };
      resourceGrants: { inboxIds: string[]; phoneNumberIds: string[] } | null;
      dailyEmailLimit: number | null;
      dailySmsLimit: number | null;
      dailyInboxLimit: number | null;
      dailyNumberLimit: number | null;
    }[]
  >([]);
  const org = organizations.find((o) => o.id === activeOrganizationId);
  const admin = org?.role === "owner" || org?.role === "admin";
  const load = useCallback(async () => {
    if (!activeOrganizationId) {
      setLoading(false);
      return;
    }
    const generation = ++inboxGeneration.current;
    setLoading(true);
    setLoadingInboxes(false);
    try {
      const i = await api<{ data: Row[]; nextCursor: string | null }>(
        "/inboxes",
      );
      if (generation !== inboxGeneration.current) return;
      setInboxes(i.data);
      setInboxCursor(i.nextCursor);
      if (section === "api-keys" && admin)
        setKeys((await api<{ data: Row[] }>("/api-keys")).data);
      if (section === "integrations")
        setConnections(
          (await api<{ data: typeof connections }>("/connections")).data,
        );
      if (section === "settings") {
        const m = await authClient.organization.getFullOrganization();
        if (m.error) throw new Error(m.error.message);
        setMembers(m.data?.members ?? []);
        setInvitations(m.data?.invitations ?? []);
        const t = await authClient.organization.listTeams({
          query: { organizationId: activeOrganizationId },
        });
        setTeams(t.data ?? []);
      }
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeOrganizationId, section, admin]);
  useEffect(() => {
    void load();
  }, [load]);
  async function loadMoreInboxes() {
    if (!inboxCursor || loadingInboxes) return;
    const generation = inboxGeneration.current;
    setLoadingInboxes(true);
    setNotice("");
    try {
      const page = await api<{ data: Row[]; nextCursor: string | null }>(
        `/inboxes?cursor=${encodeURIComponent(inboxCursor)}`,
      );
      if (generation !== inboxGeneration.current) return;
      setInboxes((prior) => [
        ...prior,
        ...page.data.filter((row) => !prior.some((item) => item.id === row.id)),
      ]);
      setInboxCursor(page.nextCursor);
    } catch (error) {
      if (generation === inboxGeneration.current)
        setNotice((error as Error).message);
    } finally {
      if (generation === inboxGeneration.current) setLoadingInboxes(false);
    }
  }
  async function act(fn: () => Promise<unknown>) {
    setNotice("");
    try {
      await fn();
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  async function chooseOrg(id: string) {
    const r = await authClient.organization.setActive({ organizationId: id });
    if (r.error) setNotice(r.error.message ?? "Could not switch organization");
    else {
      setSelected(null);
      router.refresh();
    }
  }
  async function openInbox(inbox: Row, cursor?: string) {
    const generation = ++messageGeneration.current;
    setSelected(inbox);
    setMessage(null);
    setNotice("");
    setLoadingMessages(true);
    if (!cursor) {
      setMessages([]);
      setMessageCursor(null);
    }
    try {
      const page = await api<{ data: Row[]; nextCursor: string | null }>(
        `/inboxes/${encodeURIComponent(inbox.id)}/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      if (generation !== messageGeneration.current) return;
      setMessages((prior) =>
        cursor
          ? [
              ...prior,
              ...page.data.filter(
                (row) => !prior.some((item) => item.id === row.id),
              ),
            ]
          : page.data,
      );
      setMessageCursor(page.nextCursor);
    } catch (e) {
      if (generation === messageGeneration.current)
        setNotice((e as Error).message);
    } finally {
      if (generation === messageGeneration.current) setLoadingMessages(false);
    }
  }
  const title = nav.find((n) => n[0] === section)?.[1] ?? "Overview";
  return (
    <div className="app-shell" data-dashboard-ready={!loading}>
      <aside className="sidebar">
        <Brand />
        <select
          className="workspace"
          aria-label="Organization"
          value={activeOrganizationId ?? ""}
          onChange={(e) => void chooseOrg(e.target.value)}
        >
          <option value="" disabled>
            Select workspace
          </option>
          {organizations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <div className="nav-label">WORKSPACE</div>
        {nav.slice(0, 3).map(([id, label, Icon]) => (
          <Link
            className={`side-link ${section === id ? "active" : ""}`}
            key={id}
            href={`/dashboard/${id}`}
          >
            <Icon />
            <span>{label}</span>
          </Link>
        ))}
        <div className="nav-label" style={{ marginTop: 30 }}>
          BUILD & MANAGE
        </div>
        {nav
          .slice(3)
          .filter(
            ([id]) =>
              !["usage", "approvals"].includes(id) ||
              (admin && !impersonatedBy),
          )
          .map(([id, label, Icon]) => (
            <Link
              className={`side-link ${section === id ? "active" : ""}`}
              key={id}
              href={`/dashboard/${id}`}
            >
              <Icon />
              <span>{label}</span>
            </Link>
          ))}
        <div className="sidebar-bottom">
          {user.role === "admin" && !impersonatedBy && (
            <Link className="side-link" href="/support">
              <ShieldCheck />
              <span>Support access</span>
            </Link>
          )}
          <Link className="side-link" href="/docs">
            <BookOpen />
            <span>Documentation</span>
          </Link>
          <div className="profile">
            <span className="avatar">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <span>{user.name}</span>
            <button
              aria-label="Sign out"
              onClick={async () => {
                await authClient.signOut();
                window.location.href = "/login";
              }}
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>
      <div className="app-body">
        {impersonatedBy && (
          <div className="status-banner">
            Impersonating {user.name}
            <button
              onClick={async () => {
                await authClient.admin.stopImpersonating();
                router.refresh();
              }}
            >
              Stop impersonating
            </button>
          </div>
        )}
        <header className="app-header">
          <span>
            {org?.name ?? "Your workspace"}{" "}
            <span style={{ margin: "0 12px", color: "#bbc2b4" }}>/</span>{" "}
            {title}
          </span>
          <Link href="/docs">
            Developer docs <ArrowUpRight size={14} />
          </Link>
        </header>
        <main className="main-content">
          {!activeOrganizationId ? (
            <>
              <div className="page-title">
                <div>
                  <h1>Make yourself at home.</h1>
                  <p>
                    Create a workspace for your agents, or select one you've
                    joined.
                  </p>
                </div>
              </div>
              <div className="panel">
                <div className="panel-body" style={{ maxWidth: 420 }}>
                  <NameForm
                    label="Workspace name"
                    onSave={async ({ name }) => {
                      const r = await authClient.organization.create({
                        name,
                        slug:
                          name.toLowerCase().replace(/[^a-z0-9]+/g, "-") +
                          "-" +
                          crypto.randomUUID().slice(0, 6),
                      });
                      if (r.error) throw new Error(r.error.message);
                      await chooseOrg(r.data!.id);
                    }}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="page-title">
                <div>
                  <h1>
                    {section === "overview"
                      ? `Good to see you, ${user.name.split(" ")[0]}.`
                      : title}
                  </h1>
                  <p>
                    {section === "overview"
                      ? "A little infrastructure. A world of possibilities."
                      : section === "inboxes"
                        ? "A dedicated home for every conversation."
                        : section === "numbers"
                          ? "A direct line between your agents and the world."
                          : "Your workspace, connected and under control."}
                  </p>
                </div>
                {["inboxes", "api-keys"].includes(section) && admin && (
                  <button
                    className="button small"
                    onClick={() => setModal(section)}
                  >
                    <Plus size={16} />
                    {section === "inboxes" ? "Create inbox" : "Create API key"}
                  </button>
                )}
              </div>
              {notice && (
                <div className="notice error" role="alert">
                  {notice}
                </div>
              )}
              {loading ? (
                <div className="loading">Loading your workspace…</div>
              ) : (
                <>
                  {section === "overview" && (
                    <>
                      <WorkspaceSetup
                        key={activeOrganizationId}
                        inbox={inboxes.find(
                          (inbox) => inbox.status === "active",
                        )}
                        canManage={admin && !impersonatedBy}
                        onCreateInbox={() => setModal("inboxes")}
                        onCreateKey={() => setModal("api-keys")}
                      />
                      <div className="stats">
                        <div className="stat">
                          <div className="stat-label">
                            EMAIL INBOXES <Mail />
                          </div>
                          <strong>
                            {
                              inboxes.filter((i) => i.status === "active")
                                .length
                            }
                          </strong>
                          <small>
                            {inboxCursor
                              ? "Active inboxes in the first 100 results"
                              : "Connected through Resend"}
                          </small>
                        </div>
                        <div className="stat">
                          <div className="stat-label">
                            MESSAGES <Activity />
                          </div>
                          <strong>
                            {inboxes.reduce(
                              (n, i) => n + (i._count?.messages ?? 0),
                              0,
                            )}
                          </strong>
                          <small>
                            {inboxCursor
                              ? "Across the first 100 inboxes"
                              : "Across all your inboxes"}
                          </small>
                        </div>
                      </div>
                      <div className="panel">
                        <div className="panel-head">
                          <h2>Your inboxes</h2>
                          <Link href="/dashboard/inboxes">
                            View all <span>↗</span>
                          </Link>
                        </div>
                        {inboxes.length ? (
                          <ResourceTable
                            rows={inboxes}
                            onClick={() => router.push("/dashboard/inboxes")}
                          />
                        ) : (
                          <Empty
                            title="Create your first inbox."
                            text="Choose an email address for your workspace."
                            action={admin ? "Create inbox" : undefined}
                            onClick={() => setModal("inboxes")}
                          />
                        )}
                      </div>
                      <div className="grid-two">
                        <div className="setup-card">
                          <Terminal size={22} />
                          <h3>From zero to connected.</h3>
                          <p>
                            One API key. Your agent's favorite language.
                            <br />
                            Get your first integration running.
                          </p>
                          <Link className="text-link" href="/docs">
                            Open the quickstart <ArrowUpRight size={14} />
                          </Link>
                        </div>
                        <div className="setup-card">
                          <Phone size={22} />
                          <h3>A phone number for your workspace.</h3>
                          <p>
                            Search available numbers and choose your address for
                            SMS.
                            <br />
                            Send and receive messages through the same API.
                          </p>
                          <Link className="text-link" href="/dashboard/numbers">
                            View phone availability <ArrowRight size={14} />
                          </Link>
                        </div>
                      </div>
                    </>
                  )}
                  {section === "inboxes" &&
                    (selected ? (
                      <>
                        <button
                          className="back"
                          onClick={() => {
                            ++messageGeneration.current;
                            setLoadingMessages(false);
                            setSelected(null);
                            setMessage(null);
                          }}
                        >
                          <ArrowLeft size={14} /> All inboxes
                        </button>
                        <div className="panel">
                          <div className="panel-head">
                            <h2>{selected.address}</h2>
                            <div className="row-actions">
                              <button
                                className="button secondary small"
                                onClick={() => void openInbox(selected)}
                              >
                                Refresh
                              </button>
                              <button
                                className="button small"
                                onClick={() => setModal("compose")}
                                disabled={
                                  !admin || selected.status !== "active"
                                }
                              >
                                <Plus size={14} /> Compose
                              </button>
                            </div>
                          </div>
                          {selected.status === "archived" && (
                            <div className="notice" role="status">
                              This inbox is archived. Existing messages remain
                              readable; new sends and incoming storage are
                              stopped.
                            </div>
                          )}
                          {admin && (
                            <InboxLifecycle
                              key={`${selected.id}:${selected.status}`}
                              id={selected.id}
                              status={selected.status ?? "active"}
                              onChanged={(status) => {
                                const id = selected.id;
                                setInboxes((rows) =>
                                  rows.map((row) =>
                                    row.id === id ? { ...row, status } : row,
                                  ),
                                );
                                setSelected((current) =>
                                  current?.id === id
                                    ? { ...current, status }
                                    : current,
                                );
                              }}
                            />
                          )}
                          {message ? (
                            <>
                              <button
                                className="back"
                                style={{ margin: 20 }}
                                onClick={() => setMessage(null)}
                              >
                                <ArrowLeft size={14} /> Messages
                              </button>
                              <div className="panel-body">
                                <h2>{message.subject}</h2>
                                <p
                                  style={{
                                    marginTop: 10,
                                    color: "var(--muted)",
                                  }}
                                >
                                  From {message.from}
                                </p>
                                <div
                                  className="row-actions"
                                  style={{ marginTop: 16 }}
                                >
                                  <button
                                    className="button small"
                                    onClick={() => setModal("reply")}
                                    disabled={
                                      !admin || selected.status !== "active"
                                    }
                                  >
                                    Reply
                                  </button>
                                  <button
                                    className="button secondary small"
                                    onClick={() =>
                                      void act(async () => {
                                        await api(
                                          `/messages/${message.id}`,
                                          "PATCH",
                                          { unread: !message.unread },
                                        );
                                        setMessage({
                                          ...message,
                                          unread: !message.unread,
                                        });
                                      })
                                    }
                                  >
                                    {message.unread
                                      ? "Mark as read"
                                      : "Mark as unread"}
                                  </button>
                                </div>
                              </div>
                              <div className="message-view">
                                {message.text ||
                                  "This message has no plain-text body."}
                              </div>
                              <div className="panel-body">
                                <EmailAttachments
                                  key={message.id}
                                  messageId={message.id}
                                  initial={message.attachments ?? []}
                                />
                              </div>
                            </>
                          ) : loadingMessages && !messages.length ? (
                            <div className="panel-body" role="status">
                              Loading messages…
                            </div>
                          ) : messages.length ? (
                            <table className="table">
                              <thead>
                                <tr>
                                  <th>FROM / TO</th>
                                  <th>SUBJECT</th>
                                  <th>STATUS</th>
                                </tr>
                              </thead>
                              <tbody>
                                {messages.map((m) => (
                                  <tr
                                    key={m.id}
                                    className="clickable"
                                    onClick={() =>
                                      void act(async () => {
                                        const loaded = await api<Row>(
                                          `/messages/${m.id}`,
                                        );
                                        await api(
                                          `/messages/${m.id}`,
                                          "PATCH",
                                          { unread: false },
                                        );
                                        setMessage({
                                          ...loaded,
                                          unread: false,
                                        });
                                      })
                                    }
                                  >
                                    <td>
                                      {m.from}
                                      <small>{m.direction}</small>
                                    </td>
                                    <td>{m.subject || "(No subject)"}</td>
                                    <td>
                                      <span className="badge">{m.status}</span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <Empty
                              title="A clean slate."
                              text={
                                selected.status === "archived"
                                  ? "No messages were stored before this inbox was archived."
                                  : `Messages sent to ${selected.address} will appear here.`
                              }
                            />
                          )}
                          {!message && messageCursor && (
                            <div className="panel-body">
                              <button
                                className="button secondary small"
                                disabled={loadingMessages}
                                onClick={() =>
                                  void openInbox(selected, messageCursor)
                                }
                              >
                                {loadingMessages
                                  ? "Loading messages…"
                                  : "Load older messages"}
                              </button>
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="panel">
                        {inboxes.length ? (
                          <>
                            <ResourceTable rows={inboxes} onClick={openInbox} />
                            {inboxCursor && (
                              <div className="panel-body">
                                <button
                                  className="button secondary small"
                                  disabled={loadingInboxes}
                                  onClick={() => void loadMoreInboxes()}
                                >
                                  {loadingInboxes
                                    ? "Loading inboxes…"
                                    : "Load more inboxes"}
                                </button>
                              </div>
                            )}
                          </>
                        ) : (
                          <Empty
                            title="Create your first inbox."
                            text="Choose an address at papers.bot. We'll take care of the delivery."
                            action="Create inbox"
                            onClick={() => setModal("inboxes")}
                          />
                        )}
                      </div>
                    ))}
                  {section === "numbers" && (
                    <PhoneDashboard
                      key={activeOrganizationId}
                      canSend={admin}
                    />
                  )}
                  {section === "api-keys" && (
                    <>
                      <div className="notice">
                        Keys are scoped to this workspace. Copy a new key once
                        and store it securely.
                      </div>
                      <div className="panel">
                        {keys.length ? (
                          <table className="table">
                            <thead>
                              <tr>
                                <th>NAME</th>
                                <th>KEY</th>
                                <th>STATUS</th>
                                <th />
                              </tr>
                            </thead>
                            <tbody>
                              {keys.map((k) => (
                                <tr key={k.id}>
                                  <td>
                                    {k.name}
                                    <small>
                                      {k.resourceGrants
                                        ? `${k.resourceGrants.inboxIds.length} inboxes · ${k.resourceGrants.phoneNumberIds.length} numbers selected`
                                        : "All workspace resources"}
                                    </small>
                                    <small>
                                      Email/day:{" "}
                                      {k.dailyEmailLimit ?? "Workspace limit"} ·
                                      SMS/day:{" "}
                                      {k.dailySmsLimit ?? "Workspace limit"} ·
                                      Inboxes/day:{" "}
                                      {k.dailyInboxLimit ?? "Workspace limit"} ·
                                      Numbers/day:{" "}
                                      {k.dailyNumberLimit ?? "Workspace limit"}
                                    </small>
                                  </td>
                                  <td className="mono">{k.prefix}…</td>
                                  <td>
                                    <span className="badge">
                                      {k.revokedAt ? "Revoked" : "Active"}
                                    </span>
                                  </td>
                                  <td>
                                    {!k.revokedAt && (
                                      <button
                                        className="button secondary small"
                                        onClick={() =>
                                          void act(() =>
                                            api(`/api-keys/${k.id}`, "DELETE"),
                                          )
                                        }
                                      >
                                        Revoke
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <Empty
                            title="Create your first API key."
                            text="Create a scoped workspace key to start using the API."
                            action="Create API key"
                            onClick={() => setModal("api-keys")}
                          />
                        )}
                      </div>
                    </>
                  )}
                  {section === "approvals" &&
                    (admin && !impersonatedBy ? (
                      <ApprovalReview key={activeOrganizationId} />
                    ) : (
                      <p>
                        Only workspace owners and admins can review approvals.
                      </p>
                    ))}
                  {section === "usage" &&
                    (admin && !impersonatedBy ? (
                      <WorkspaceUsage key={activeOrganizationId} />
                    ) : (
                      <p>Only workspace owners and admins can view usage.</p>
                    ))}
                  {section === "integrations" && (
                    <>
                      {admin && !impersonatedBy && (
                        <WebhookSettings key={activeOrganizationId} />
                      )}
                      <div className="panel" style={{ marginBottom: 24 }}>
                        <div className="panel-head">
                          <h2>Your connected applications</h2>
                        </div>
                        {connections.length ? (
                          <table className="table">
                            <thead>
                              <tr>
                                <th>APPLICATION</th>
                                <th>PERMISSIONS</th>
                                <th />
                              </tr>
                            </thead>
                            <tbody>
                              {connections.map((connection) => (
                                <tr key={connection.id}>
                                  <td>
                                    {connection.oauthclient.name ??
                                      "Agent application"}
                                  </td>
                                  <td>
                                    {connection.scopes.join(", ")}
                                    <small>
                                      {connection.resourceGrants
                                        ? `${connection.resourceGrants.inboxIds.length} inboxes · ${connection.resourceGrants.phoneNumberIds.length} numbers selected`
                                        : "All workspace resources"}
                                    </small>
                                    <small>
                                      Email/day:{" "}
                                      {connection.dailyEmailLimit ??
                                        "Workspace limit"}{" "}
                                      · SMS/day:{" "}
                                      {connection.dailySmsLimit ??
                                        "Workspace limit"}{" "}
                                      · Inboxes/day:{" "}
                                      {connection.dailyInboxLimit ??
                                        "Workspace limit"}{" "}
                                      · Numbers/day:{" "}
                                      {connection.dailyNumberLimit ??
                                        "Workspace limit"}
                                    </small>
                                    {admin && !impersonatedBy && (
                                      <ConnectionLimits
                                        key={`${connection.id}:${connection.dailyEmailLimit}:${connection.dailySmsLimit}:${connection.dailyInboxLimit}:${connection.dailyNumberLimit}`}
                                        id={connection.id}
                                        email={connection.dailyEmailLimit}
                                        sms={connection.dailySmsLimit}
                                        inboxes={connection.dailyInboxLimit}
                                        numbers={connection.dailyNumberLimit}
                                        onSaved={load}
                                      />
                                    )}
                                  </td>
                                  <td>
                                    <button
                                      className="button secondary small"
                                      disabled={!!impersonatedBy}
                                      onClick={() =>
                                        void act(async () => {
                                          await api(
                                            `/connections/${connection.id}`,
                                            "DELETE",
                                          );
                                          await load();
                                        })
                                      }
                                    >
                                      Revoke
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <Empty
                            title="No connected applications yet."
                            text="Connect an agent through OAuth to review and revoke its access here."
                          />
                        )}
                      </div>
                      <div className="grid-two">
                        {[
                          "Claude",
                          "ChatGPT",
                          "Grok",
                          "Python",
                          "TypeScript",
                          "cURL",
                        ].map((n) => (
                          <div className="panel" key={n}>
                            <div className="panel-body">
                              <Plug size={22} color="var(--green)" />
                              <h3 style={{ margin: "15px 0 10px" }}>{n}</h3>
                              <p
                                style={{
                                  color: "var(--muted)",
                                  lineHeight: 1.8,
                                  fontSize: 12,
                                }}
                              >
                                Connect your workspace with {n}. Integration
                                setup and examples are in the developer guide.
                              </p>
                              <Link
                                className="text-link"
                                style={{ marginTop: 20 }}
                                href="/docs"
                              >
                                View setup <ArrowUpRight size={14} />
                              </Link>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="notice info">
                        Public directory listings require provider review. This
                        workspace does not yet have published store listings.
                      </div>
                    </>
                  )}
                  {section === "settings" && (
                    <>
                      <WorkspaceLimits
                        key={activeOrganizationId}
                        canEdit={org?.role === "owner" && !impersonatedBy}
                      />
                      <div className="panel">
                        <div className="panel-head">
                          <h2>Workspace members</h2>
                          {admin && (
                            <button
                              className="button small"
                              onClick={() => setModal("invite")}
                            >
                              <Plus size={14} /> Invite member
                            </button>
                          )}
                        </div>
                        <table className="table">
                          <thead>
                            <tr>
                              <th>MEMBER</th>
                              <th>ROLE</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {members.map((m) => (
                              <tr key={m.id}>
                                <td>
                                  {m.user?.name}
                                  <small>{m.user?.email}</small>
                                </td>
                                <td>
                                  {admin &&
                                  (org?.role === "owner" ||
                                    m.role !== "owner") ? (
                                    <select
                                      aria-label={`Role for ${m.user?.email}`}
                                      value={m.role}
                                      onChange={(event) =>
                                        void act(async () => {
                                          const r =
                                            await authClient.organization.updateMemberRole(
                                              {
                                                memberId: m.id,
                                                role: event.target.value as
                                                  "owner" | "admin" | "member",
                                                organizationId:
                                                  activeOrganizationId!,
                                              },
                                            );
                                          if (r.error)
                                            throw new Error(r.error.message);
                                          await load();
                                        })
                                      }
                                    >
                                      <option value="member">Member</option>
                                      <option value="admin">Admin</option>
                                      {org?.role === "owner" && (
                                        <option value="owner">Owner</option>
                                      )}
                                    </select>
                                  ) : (
                                    m.role
                                  )}
                                </td>
                                <td>
                                  {admin &&
                                    m.role !== "owner" &&
                                    m.user?.email !== user.email && (
                                      <button
                                        className="button secondary small"
                                        onClick={() =>
                                          void act(async () => {
                                            const r =
                                              await authClient.organization.removeMember(
                                                { memberIdOrEmail: m.id },
                                              );
                                            if (r.error)
                                              throw new Error(r.error.message);
                                          })
                                        }
                                      >
                                        Remove
                                      </button>
                                    )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="grid-two">
                        <div className="panel">
                          <div className="panel-head">
                            <h2>Teams</h2>
                            {admin && (
                              <button
                                className="button secondary small"
                                onClick={() => setModal("team")}
                              >
                                <Plus size={14} /> New team
                              </button>
                            )}
                          </div>
                          {teams.map((t) => (
                            <TeamMembers
                              key={t.id}
                              teamId={t.id}
                              name={t.name ?? "Team"}
                              members={members}
                              canManage={admin}
                            />
                          ))}
                          {!teams.length && (
                            <Empty
                              title="Organize your people."
                              text="Group workspace members into teams."
                            />
                          )}
                        </div>
                        <div className="panel">
                          <div className="panel-head">
                            <h2>Pending invitations</h2>
                          </div>
                          {invitations
                            .filter((i) => i.status === "pending")
                            .map((i) => (
                              <div className="panel-body" key={i.id}>
                                <p>{i.email}</p>
                                <small>{i.role}</small>
                                {admin && (
                                  <button
                                    className="button secondary small"
                                    onClick={() =>
                                      void act(async () => {
                                        const r =
                                          await authClient.organization.inviteMember(
                                            {
                                              email: i.email!,
                                              role: i.role as
                                                "owner" | "admin" | "member",
                                              resend: true,
                                              ...(i.teamId
                                                ? { teamId: i.teamId }
                                                : {}),
                                            },
                                          );
                                        if (r.error)
                                          throw new Error(r.error.message);
                                      })
                                    }
                                  >
                                    Resend
                                  </button>
                                )}
                                {admin && (
                                  <button
                                    className="button secondary small"
                                    onClick={() =>
                                      void act(async () => {
                                        const r =
                                          await authClient.organization.cancelInvitation(
                                            { invitationId: i.id },
                                          );
                                        if (r.error)
                                          throw new Error(r.error.message);
                                      })
                                    }
                                  >
                                    Cancel
                                  </button>
                                )}
                              </div>
                            ))}
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>
      {modal && (
        <Modal
          title={
            modal === "inboxes"
              ? "Create an inbox"
              : modal === "api-keys"
                ? "Create API key"
                : modal === "team"
                  ? "Create team"
                  : modal === "invite"
                    ? "Invite a teammate"
                    : "New message"
          }
          close={() => {
            setModal("");
            setToken("");
          }}
        >
          {modal === "team" ? (
            <NameForm
              label="Team name"
              onSave={async (v) => {
                const r = await authClient.organization.createTeam({
                  ...v,
                  organizationId: activeOrganizationId!,
                });
                if (r.error) throw new Error(r.error.message);
                setModal("");
                await load();
              }}
            />
          ) : token ? (
            <>
              <div className="notice">
                Copy this key now. It won't be shown again.
              </div>
              <pre className="code-block">{token}</pre>
              <button
                className="button full"
                onClick={() => void navigator.clipboard.writeText(token)}
              >
                <Copy size={15} /> Copy API key
              </button>
            </>
          ) : (
            <ActionForm
              key={activeOrganizationId}
              kind={modal}
              teams={teams}
              initialInboxId={
                section === "overview"
                  ? inboxes.find((inbox) => inbox.status === "active")?.id
                  : undefined
              }
              onSave={async (values, idempotencyKey) => {
                if (modal === "inboxes")
                  await api("/inboxes", "POST", values, idempotencyKey);
                if (modal === "api-keys") {
                  const r = await api<{ token: string }>("/api-keys", "POST", {
                    ...values,
                    resourceGrants: values.resourceSelection
                      ? resourceGrantsSchema.parse(
                          JSON.parse(values.resourceSelection),
                        )
                      : null,
                    dailyEmailLimit: values.dailyEmailLimit
                      ? Number(values.dailyEmailLimit)
                      : null,
                    dailySmsLimit: values.dailySmsLimit
                      ? Number(values.dailySmsLimit)
                      : null,
                    dailyInboxLimit: values.dailyInboxLimit
                      ? Number(values.dailyInboxLimit)
                      : null,
                    dailyNumberLimit: values.dailyNumberLimit
                      ? Number(values.dailyNumberLimit)
                      : null,
                    scopes:
                      values.permissionPreset === "inbox_read"
                        ? ["inboxes:read"]
                        : values.permissionPreset === "read_only"
                          ? [
                              "inboxes:read",
                              "numbers:read",
                              "sms:read",
                              "events:read",
                            ]
                          : [
                              "inboxes:read",
                              "inboxes:write",
                              "email:send",
                              "numbers:read",
                              "sms:read",
                              "sms:send",
                              "events:read",
                              ...(values.phoneManagement === "enabled"
                                ? values.resourceSelection
                                  ? ["numbers:release"]
                                  : ["numbers:provision", "numbers:release"]
                                : []),
                            ],
                  });
                  setToken(r.token);
                  await load();
                  return;
                }
                if (modal === "invite") {
                  const r = await authClient.organization.inviteMember({
                    email: String(values.email),
                    role: values.role === "admin" ? "admin" : "member",
                    ...(values.teamId ? { teamId: String(values.teamId) } : {}),
                  });
                  if (r.error) throw new Error(r.error.message);
                }
                if (modal === "reply") {
                  await api(
                    `/messages/${message!.id}/reply`,
                    "POST",
                    {
                      text: values.text,
                    },
                    idempotencyKey,
                  );
                  await openInbox(selected!);
                }
                if (modal === "compose") {
                  await api(
                    `/inboxes/${selected!.id}/messages`,
                    "POST",
                    {
                      to: [values.to],
                      subject: values.subject,
                      text: values.text,
                    },
                    idempotencyKey,
                  );
                  await openInbox(selected!);
                }
                setModal("");
                await load();
              }}
            />
          )}
        </Modal>
      )}
    </div>
  );
}
function Empty({
  title,
  text,
  action,
  onClick,
}: {
  title: string;
  text: string;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <div className="empty">
      <Mail size={28} strokeWidth={1.3} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <button className="button small" onClick={onClick}>
          <Plus size={14} />
          {action}
        </button>
      )}
    </div>
  );
}
function ResourceTable({
  rows,
  onClick,
}: {
  rows: Row[];
  onClick?: (r: Row) => void;
}) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>INBOX</th>
          <th>CREATED</th>
          <th>STATUS</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.id}
            className={onClick ? "clickable" : ""}
            onClick={() => onClick?.(r)}
          >
            <td>
              <div className="icon-cell">
                <span className="icon-box">
                  <Mail size={17} />
                </span>
                <div>
                  {r.name}
                  <small className="mono">
                    {r.address ?? r.id.slice(0, 15)}
                  </small>
                </div>
              </div>
            </td>
            <td>{new Date(r.createdAt!).toLocaleDateString()}</td>
            <td>
              <span className="badge green">
                <span className="live-dot" />
                {r.status ?? "Active"}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function ActionForm({
  kind,
  teams,
  initialInboxId,
  onSave,
}: {
  kind: string;
  teams: Row[];
  initialInboxId?: string;
  onSave: (v: Record<string, string>, idempotencyKey: string) => Promise<void>;
}) {
  const shape: Record<string, z.ZodType<string, string>> = kind === "inboxes"
    ? {
        name: z.string().min(1),
        localPart: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,40}$/),
      }
    : kind === "api-keys"
      ? {
          name: z.string().min(1),
          permissionPreset: z.enum(["inbox_read", "read_only", "read_write"]),
          resourceSelection: z.string().refine((value) => {
            if (!value) return true;
            try {
              return resourceGrantsSchema.safeParse(JSON.parse(value)).success;
            } catch {
              return false;
            }
          }, "Select valid inboxes and phone numbers"),
          phoneManagement: z.enum(["disabled", "enabled"]),
          dailyInboxLimit: z
            .string()
            .refine(
              (v) => v === "" || (/^\d+$/.test(v) && Number(v) <= 10000),
              "Use 0–10,000, or leave blank",
            ),
          dailyNumberLimit: z
            .string()
            .refine(
              (v) => v === "" || (/^\d+$/.test(v) && Number(v) <= 10000),
              "Use 0–10,000, or leave blank",
            ),
          dailyEmailLimit: z
            .string()
            .refine(
              (v) => v === "" || (/^\d+$/.test(v) && Number(v) <= 10000),
              "Use a whole number from 0 to 10,000, or leave blank",
            ),
          dailySmsLimit: z
            .string()
            .refine(
              (v) => v === "" || (/^\d+$/.test(v) && Number(v) <= 10000),
              "Use a whole number from 0 to 10,000, or leave blank",
            ),
        }
      : kind === "invite"
        ? { email: z.email(), role: z.string(), teamId: z.string() }
        : kind === "reply"
          ? { text: z.string().min(1) }
          : { to: z.email(), subject: z.string(), text: z.string().min(1) };
  const schema = z.object(shape);
  const {
    register,
    watch,
    setValue,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Record<string, string>>({
    resolver: zodResolver(schema),
    defaultValues: {
      role: "member",
      teamId: "",
      phoneManagement: "disabled",
      permissionPreset: initialInboxId ? "inbox_read" : "read_only",
      resourceSelection: initialInboxId
        ? JSON.stringify({ inboxIds: [initialInboxId], phoneNumberIds: [] })
        : "",
      dailyInboxLimit: "",
      dailyNumberLimit: "",
      dailyEmailLimit: "",
      dailySmsLimit: "",
    },
  });
  const [error, setError] = useState("");
  const requestKeys = useRef(new Map<string, string>());
  return (
    <form
      onSubmit={handleSubmit(async (v) => {
        try {
          const payload = JSON.stringify(v);
          const key = requestKeys.current.get(payload) ?? crypto.randomUUID();
          requestKeys.current.set(payload, key);
          await onSave(v, key);
        } catch (e) {
          setError((e as Error).message);
        }
      })}
    >
      {Object.keys(shape)
        .filter(
          (name) =>
            !(
              kind === "api-keys" &&
              watch("permissionPreset") !== "read_write" &&
              [
                "phoneManagement",
                "dailyInboxLimit",
                "dailyNumberLimit",
                "dailyEmailLimit",
                "dailySmsLimit",
              ].includes(name)
            ) &&
            !(
              watch("resourceSelection") &&
              ["dailyInboxLimit", "dailyNumberLimit"].includes(name)
            ),
        )
        .map((name) => (
          <div className="field" key={name}>
            <label htmlFor={name}>
              {
                (
                  {
                    name: "Name",
                    permissionPreset: "Permissions",
                    resourceSelection: "Resource access",
                    phoneManagement: watch("resourceSelection")
                      ? "Phone number releases"
                      : "Phone number purchases and releases",
                    dailyInboxLimit: "Daily inbox creation limit (optional)",
                    dailyNumberLimit: "Daily number purchase limit (optional)",
                    dailyEmailLimit: "Daily email limit (optional)",
                    dailySmsLimit: "Daily SMS limit (optional)",
                    localPart: "Address (before @papers.bot)",
                    email: "Email address",
                    role: "Role",
                    teamId: "Team (optional)",
                    to: "To",
                    subject: "Subject",
                    text: "Message",
                  } as Record<string, string>
                )[name]
              }
            </label>
            {name === "permissionPreset" ? (
              <select id={name} {...register(name)}>
                <option value="inbox_read">Read inboxes and email only</option>
                <option value="read_only">
                  Read email, SMS, numbers, and activity
                </option>
                <option value="read_write">
                  Read, send, and manage resources
                </option>
              </select>
            ) : name === "resourceSelection" ? (
              <KeyResourcePicker
                value={watch(name) ?? ""}
                onChange={(value) =>
                  setValue(name, value, {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
              />
            ) : name === "phoneManagement" ? (
              <select id={name} {...register(name)}>
                <option value="disabled">Not allowed</option>
                <option value="enabled">
                  {watch("resourceSelection")
                    ? "Allow permanent releases of selected numbers"
                    : "Allow purchases (charges apply) and permanent releases"}
                </option>
              </select>
            ) : name === "role" ? (
              <select id={name} {...register(name)}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            ) : name === "teamId" ? (
              <select id={name} {...register(name)}>
                <option value="">No team</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            ) : name === "text" ? (
              <textarea id={name} {...register(name)} />
            ) : (
              <input id={name} {...register(name)} />
            )}
            {[
              "dailyEmailLimit",
              "dailySmsLimit",
              "dailyInboxLimit",
              "dailyNumberLimit",
            ].includes(name) && (
              <small>
                Blank uses workspace limits. Zero blocks new actions of this
                type. Resets at midnight UTC.
              </small>
            )}
            <small>{errors[name]?.message}</small>
          </div>
        ))}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <button className="button full" disabled={isSubmitting}>
        {isSubmitting
          ? "Working…"
          : ["compose", "reply"].includes(kind)
            ? "Send message"
            : kind === "invite"
              ? "Send invitation"
              : "Create"}
      </button>
    </form>
  );
}
