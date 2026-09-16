"use client";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { authClient } from "@agentinfra/auth/client";
import { Brand } from "./brand";

const searchSchema = z.object({ email: z.email() });
type SupportUser = {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  banned?: boolean | null;
};

export function Support({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<SupportUser[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useForm<z.infer<typeof searchSchema>>({
    resolver: zodResolver(searchSchema),
  });
  async function search({ email }: z.infer<typeof searchSchema>) {
    setError("");
    setUsers([]);
    setSearched(false);
    try {
      const result = await authClient.admin.listUsers({
        query: {
          filterField: "email",
          filterOperator: "eq",
          filterValue: email.toLowerCase(),
          limit: 10,
        },
      });
      if (result.error)
        throw new Error(result.error.message ?? "Unable to find account");
      setUsers(result.data.users);
      setSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to find account");
    }
  }
  async function impersonate(userId: string) {
    setBusy(true);
    setError("");
    try {
      const result = await authClient.admin.impersonateUser({ userId });
      if (result.error)
        throw new Error(
          result.error.message ?? "Unable to start support session",
        );
      window.location.assign("/dashboard");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to start support session",
      );
      setBusy(false);
    }
  }
  return (
    <main className="docs">
      <Brand />
      <p>
        <Link href="/dashboard">Back to dashboard</Link>
      </p>
      <h1>Support access</h1>
      <p>
        Find an account by its exact email address. Support sessions expire
        after 15 minutes and display an impersonation banner.
      </p>
      <form onSubmit={form.handleSubmit(search)} className="panel-body">
        <label htmlFor="support-email">Account email</label>
        <input
          id="support-email"
          type="email"
          {...form.register("email")}
          autoComplete="off"
          required
        />
        {form.formState.errors.email && (
          <p role="alert">Enter a valid email address.</p>
        )}
        <button
          className="button"
          disabled={form.formState.isSubmitting || busy}
        >
          Find account
        </button>
      </form>
      {searched && !users.length && <p>No matching account.</p>}
      {users.map((user) => (
        <div className="panel-body" key={user.id}>
          <strong>{user.name}</strong>
          <p>{user.email}</p>
          <button
            className="button secondary"
            disabled={
              busy ||
              user.id === currentUserId ||
              user.role === "admin" ||
              !!user.banned
            }
            onClick={() => void impersonate(user.id)}
          >
            Start support session
          </button>
        </div>
      ))}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
    </main>
  );
}
