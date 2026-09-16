"use client";
import { useCallback, useEffect, useState } from "react";
import { authClient } from "@agentinfra/auth/client";

export function TeamMembers({
  teamId,
  name,
  members,
  canManage,
}: {
  teamId: string;
  name: string;
  members: {
    id: string;
    userId?: string;
    user?: { name: string; email: string };
  }[];
  canManage: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [assigned, setAssigned] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await authClient.organization.listTeamMembers({
      query: { teamId },
    });
    if (r.error) throw new Error(r.error.message);
    setAssigned((r.data ?? []).map((m) => m.userId));
  }, [teamId]);
  useEffect(() => {
    if (expanded) void load().catch((e) => setError(e.message));
  }, [expanded, load]);
  async function toggle(userId: string, add: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = add
        ? await authClient.organization.addTeamMember({ teamId, userId })
        : await authClient.organization.removeTeamMember({ teamId, userId });
      if (r.error) throw new Error(r.error.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update the team");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="panel-body">
      <div className="row-actions">
        <strong>{name}</strong>
        <button
          className="button secondary small"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Close" : "Members"}
        </button>
      </div>
      {expanded && (
        <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
          {members
            .filter(
              (m) => m.userId && (canManage || assigned.includes(m.userId)),
            )
            .map((m) => (
              <label
                key={m.id}
                style={{ display: "flex", gap: 10, alignItems: "center" }}
              >
                <input
                  type="checkbox"
                  checked={assigned.includes(m.userId!)}
                  disabled={!canManage || busy}
                  onChange={(e) => void toggle(m.userId!, e.target.checked)}
                />
                {m.user?.name ?? m.user?.email}
              </label>
            ))}
          {!assigned.length && <small>No members assigned yet.</small>}
        </div>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
    </div>
  );
}
