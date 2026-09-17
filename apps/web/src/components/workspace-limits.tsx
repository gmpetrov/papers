"use client";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  workspacePolicyInput,
  type WorkspacePolicy,
} from "@agentinfra/contracts";

const fields = [
  ["dailyEmailLimit", "Emails per day", 10000],
  ["dailySmsLimit", "SMS per day", 10000],
  ["maxInboxes", "Active inboxes", 1000],
  ["maxPhoneNumbers", "Phone numbers", 100],
] as const;
type Usage = {
  day: string;
  emailSends: number;
  smsSends: number;
  inboxes: number;
  phoneNumbers: number;
};

export function WorkspaceLimits({ canEdit }: { canEdit: boolean }) {
  const [usage, setUsage] = useState<Usage>();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<WorkspacePolicy>({ resolver: zodResolver(workspacePolicyInput) });
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/v1/workspace/policy", { signal: controller.signal })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok)
          throw new Error(
            data.error?.message ?? "Unable to load workspace limits",
          );
        reset(data.policy);
        setUsage(data.usage);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [reset]);

  return (
    <section className="panel" aria-labelledby="workspace-limits-title">
      <div className="panel-head">
        <h2 id="workspace-limits-title">Workspace limits</h2>
      </div>
      <div className="panel-body" style={{ display: "grid", gap: 20 }}>
        <p>
          Daily limits reset at midnight UTC. Zero pauses sending or creating
          resources. Existing resources and messages are kept.
        </p>
        {usage && (
          <>
            <p>
              Today ({usage.day}, UTC): {usage.emailSends} emails ·{" "}
              {usage.smsSends} SMS. Resources: {usage.inboxes} active inboxes ·{" "}
              {usage.phoneNumbers} phone numbers.
            </p>
            <form
              onSubmit={handleSubmit(async (input) => {
                setError("");
                setNotice("");
                try {
                  const r = await fetch("/v1/workspace/policy", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(input),
                  });
                  const data = await r.json();
                  if (!r.ok)
                    throw new Error(
                      data.error?.message ?? "Unable to save workspace limits",
                    );
                  reset(data.policy);
                  setNotice("Workspace limits saved.");
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Unable to save workspace limits",
                  );
                }
              })}
              style={{ display: "grid", gap: 16 }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
                  gap: 20,
                }}
              >
                {fields.map(([key, label, max]) => (
                  <div key={key} className="field">
                    <label htmlFor={`workspace-${key}`}>{label}</label>
                    <input
                      id={`workspace-${key}`}
                      type="number"
                      min={0}
                      max={max}
                      step={1}
                      disabled={!canEdit || isSubmitting}
                      {...register(key, { valueAsNumber: true })}
                      aria-invalid={!!errors[key]}
                    />
                    {errors[key] && (
                      <small role="alert">{errors[key]?.message}</small>
                    )}
                  </div>
                ))}
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="checkbox"
                  {...register("requireSmsApproval")}
                  disabled={!canEdit || isSubmitting}
                />
                Require human approval for SMS sent through API keys or
                connected applications
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="checkbox"
                  {...register("requireEmailApproval")}
                  disabled={!canEdit || isSubmitting}
                />
                Require human approval for emails sent through API keys or
                connected applications
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="checkbox"
                  {...register("requireProvisioningApproval")}
                  disabled={!canEdit || isSubmitting}
                />
                Require human approval for inboxes and phone numbers created
                through API keys or connected applications
              </label>
              <small>
                Approval applies to the exact recipient and message. Dashboard
                sends still follow workspace limits. Saving policy changes
                invalidates outstanding approvals.
              </small>
              {canEdit ? (
                <button
                  className="button"
                  style={{ justifySelf: "start" }}
                  disabled={isSubmitting || !isDirty}
                >
                  {isSubmitting ? "Saving…" : "Save limits"}
                </button>
              ) : (
                <small>
                  Only workspace owners using their own session can change
                  limits.
                </small>
              )}
            </form>
          </>
        )}
        {!usage && !error && <p>Loading limits…</p>}
        {notice && <p role="status">{notice}</p>}
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
