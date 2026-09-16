"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  smsInput,
  smsFailureSchema,
  describeSmsFailure,
} from "@agentinfra/contracts";
import type { z } from "zod";
type Operation = {
  id: string;
  status: string;
  messageId?: string;
  resourceId?: string;
  failure?: unknown;
  result?: { failure?: unknown };
};
export function SmsComposer({
  numberId,
  address,
  keys,
}: {
  numberId: string;
  address: string;
  keys: Map<string, string>;
}) {
  const form = useForm<z.infer<typeof smsInput>>({
    resolver: zodResolver(smsInput),
    defaultValues: { to: "", text: "" },
  });
  const [operation, setOperation] = useState<Operation | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  async function submit(values: z.infer<typeof smsInput>) {
    setError("");
    const fingerprint = JSON.stringify({ numberId, ...values });
    const key = keys.get(fingerprint) ?? crypto.randomUUID();
    keys.set(fingerprint, key);
    try {
      const response = await fetch(
        `/v1/phone-numbers/${encodeURIComponent(numberId)}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": key,
          },
          body: JSON.stringify(values),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error?.message ?? "Unable to submit SMS");
      setOperation(data);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to submit SMS. Retry with the same message.",
      );
    }
  }
  async function check() {
    if (!operation) return;
    setChecking(true);
    setError("");
    try {
      const response = await fetch(
        `/v1/operations/${encodeURIComponent(operation.id)}`,
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error?.message ?? "Unable to check status");
      setOperation(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to check status");
    } finally {
      setChecking(false);
    }
  }
  function startNew() {
    keys.delete(JSON.stringify({ numberId, ...form.getValues() }));
    setOperation(null);
    setError("");
    form.reset();
  }
  const failure = smsFailureSchema.safeParse(
    operation?.failure ?? operation?.result?.failure,
  );
  return (
    <section className="panel-body" aria-label="Compose SMS">
      <h3>Send SMS</h3>
      <p>From {address}</p>
      {operation ? (
        <div role="status" className="notice">
          <p>
            {operation.status === "completed"
              ? "Telnyx accepted the SMS. Delivery updates will appear in message history."
              : operation.status === "failed"
                ? "The SMS request failed."
                : "The send outcome is not confirmed yet. Check this operation before sending another message."}
          </p>
          {operation.status !== "completed" && failure.success && (
            <>
              <p>{describeSmsFailure(failure.data)}</p>
              {failure.data.httpStatus && (
                <p>Provider HTTP status: {failure.data.httpStatus}</p>
              )}
              {failure.data.providerCodes.length > 0 && (
                <p>
                  Telnyx error codes: {failure.data.providerCodes.join(", ")}
                </p>
              )}
            </>
          )}
          <p className="mono">Operation: {operation.id}</p>
          <button
            className="button secondary small"
            disabled={checking}
            onClick={() => void check()}
          >
            Check send status
          </button>
          {["completed", "failed"].includes(operation.status) && (
            <button className="button secondary small" onClick={startNew}>
              New SMS
            </button>
          )}
        </div>
      ) : (
        <form
          method="post"
          onSubmit={form.handleSubmit(submit)}
          style={{ display: "grid", gap: 12, marginTop: 16 }}
        >
          <label htmlFor="sms-recipient">Recipient phone number</label>
          <input
            id="sms-recipient"
            type="tel"
            placeholder="+12025550100"
            {...form.register("to")}
            disabled={form.formState.isSubmitting}
          />
          {form.formState.errors.to && (
            <p role="alert">
              Use an international phone number starting with +.
            </p>
          )}
          <label htmlFor="sms-text">Message</label>
          <textarea
            id="sms-text"
            rows={5}
            maxLength={1600}
            {...form.register("text")}
            disabled={form.formState.isSubmitting}
          />
          {form.formState.errors.text && (
            <p role="alert">Enter a message of up to 1,600 characters.</p>
          )}
          <button className="button" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Submitting…" : "Send SMS"}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
    </section>
  );
}
