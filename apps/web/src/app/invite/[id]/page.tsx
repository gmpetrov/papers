"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { authClient } from "@agentinfra/auth/client";
import { Brand } from "@/components/brand";
type Details = {
  organizationName: string;
  email: string;
  role: string;
  inviterEmail: string;
};
export default function Invite({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: session, isPending } = authClient.useSession();
  const [error, setError] = useState("");
  const [details, setDetails] = useState<Details | null>(null);
  const [busy, setBusy] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [acceptedOrganization, setAcceptedOrganization] = useState<
    string | null
  >(null);
  useEffect(() => {
    let active = true;
    setDetails(null);
    setError("");
    setDeclined(false);
    setAcceptedOrganization(null);
    if (session) {
      void authClient.organization
        .getInvitation({ query: { id } })
        .then((result) => {
          if (!active) return;
          if (result.error)
            setError(result.error.message ?? "This invitation is unavailable.");
          else setDetails(result.data);
        })
        .catch(() => {
          if (active)
            setError("Unable to load invitation. Please reload to try again.");
        });
    }
    return () => {
      active = false;
    };
  }, [id, session?.user.id]);
  async function openWorkspace(organizationId: string) {
    const result = await authClient.organization.setActive({ organizationId });
    if (result.error)
      throw new Error(result.error.message ?? "Unable to select workspace");
    window.location.assign("/dashboard");
  }
  async function respond(accept: boolean) {
    setBusy(true);
    setError("");
    try {
      if (acceptedOrganization) {
        await openWorkspace(acceptedOrganization);
        return;
      }
      if (accept) {
        const result = await authClient.organization.acceptInvitation({
          invitationId: id,
        });
        if (result.error)
          throw new Error(
            result.error.message ?? "Unable to accept invitation",
          );
        const organizationId = result.data.invitation.organizationId;
        setAcceptedOrganization(organizationId);
        await openWorkspace(organizationId);
      } else {
        const result = await authClient.organization.rejectInvitation({
          invitationId: id,
        });
        if (result.error)
          throw new Error(
            result.error.message ?? "Unable to decline invitation",
          );
        setDeclined(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update invitation");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="docs">
      <Brand />
      <h1>
        {declined
          ? "Invitation declined."
          : acceptedOrganization
            ? "You've joined the workspace."
            : "You're invited."}
      </h1>
      {isPending ? (
        <p>Loading your account…</p>
      ) : !session ? (
        <>
          <p>
            Sign in with the invited email address to review your invitation.
          </p>
          <Link
            className="button"
            href={`/login?next=${encodeURIComponent("/invite/" + id)}`}
          >
            Sign in to continue
          </Link>
        </>
      ) : declined ? (
        <Link className="button secondary" href="/dashboard">
          Back to dashboard
        </Link>
      ) : acceptedOrganization ? (
        <button
          className="button"
          disabled={busy}
          onClick={() => void respond(true)}
        >
          Open workspace
        </button>
      ) : details ? (
        <>
          <p>
            {details.inviterEmail} invited you to{" "}
            <strong>{details.organizationName}</strong> as {details.role}.
          </p>
          <p>Signed in as {session.user.email}.</p>
          <div className="row-actions">
            <button
              className="button"
              disabled={busy}
              onClick={() => void respond(true)}
            >
              Accept invitation
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void respond(false)}
            >
              Decline invitation
            </button>
          </div>
        </>
      ) : !error ? (
        <p>Loading invitation…</p>
      ) : (
        <p>
          Signed in as {session.user.email}. Invitations require the matching,
          verified email address.
        </p>
      )}
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
    </main>
  );
}
