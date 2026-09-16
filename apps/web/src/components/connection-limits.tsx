"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
const limit = z
  .string()
  .refine(
    (value) => value === "" || (/^\d+$/.test(value) && Number(value) <= 10000),
    "Use 0–10,000, or leave blank",
  );
const schema = z.object({
  dailyEmailLimit: limit,
  dailySmsLimit: limit,
  dailyInboxLimit: limit,
  dailyNumberLimit: limit,
});
export function ConnectionLimits({
  id,
  email,
  sms,
  inboxes,
  numbers,
  onSaved,
}: {
  id: string;
  email: number | null;
  sms: number | null;
  inboxes: number | null;
  numbers: number | null;
  onSaved: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      dailyInboxLimit: inboxes == null ? "" : String(inboxes),
      dailyNumberLimit: numbers == null ? "" : String(numbers),
      dailyEmailLimit: email == null ? "" : String(email),
      dailySmsLimit: sms == null ? "" : String(sms),
    },
  });
  return (
    <details>
      <summary>Daily limits</summary>
      <form
        onSubmit={handleSubmit(async (values) => {
          setError("");
          try {
            const response = await fetch(
              `/v1/connections/${encodeURIComponent(id)}/limits`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  dailyInboxLimit:
                    values.dailyInboxLimit === ""
                      ? null
                      : Number(values.dailyInboxLimit),
                  dailyNumberLimit:
                    values.dailyNumberLimit === ""
                      ? null
                      : Number(values.dailyNumberLimit),
                  dailyEmailLimit:
                    values.dailyEmailLimit === ""
                      ? null
                      : Number(values.dailyEmailLimit),
                  dailySmsLimit:
                    values.dailySmsLimit === ""
                      ? null
                      : Number(values.dailySmsLimit),
                }),
              },
            );
            if (!response.ok)
              throw new Error(
                (await response.json()).error?.message ??
                  "Unable to save limits",
              );
            await onSaved();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Unable to save limits");
          }
        })}
      >
        <div className="field">
          <label htmlFor={`${id}-email`}>Daily email limit</label>
          <input
            id={`${id}-email`}
            inputMode="numeric"
            {...register("dailyEmailLimit")}
          />
          <small>{errors.dailyEmailLimit?.message}</small>
        </div>
        <div className="field">
          <label htmlFor={`${id}-sms`}>Daily SMS limit</label>
          <input
            id={`${id}-sms`}
            inputMode="numeric"
            {...register("dailySmsLimit")}
          />
          <small>{errors.dailySmsLimit?.message}</small>
        </div>
        <div className="field">
          <label htmlFor={`${id}-inboxes`}>Daily inbox creation limit</label>
          <input
            id={`${id}-inboxes`}
            inputMode="numeric"
            {...register("dailyInboxLimit")}
          />
          <small>{errors.dailyInboxLimit?.message}</small>
        </div>
        <div className="field">
          <label htmlFor={`${id}-numbers`}>Daily number purchase limit</label>
          <input
            id={`${id}-numbers`}
            inputMode="numeric"
            {...register("dailyNumberLimit")}
          />
          <small>{errors.dailyNumberLimit?.message}</small>
        </div>
        <p>
          Blank uses workspace limits. Zero blocks new actions of that type.
          Resets at midnight UTC.
        </p>
        {error && <p role="alert">{error}</p>}
        <button className="button secondary small" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save limits"}
        </button>
      </form>
    </details>
  );
}
