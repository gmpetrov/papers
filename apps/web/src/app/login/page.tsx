"use client";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { authClient } from "@agentinfra/auth/client";
import { Brand } from "@/components/brand";
const schema = z.object({
  email: z.email(),
  password: z.string().min(8),
  name: z.string(),
});
function Login() {
  const query = useSearchParams();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "", name: "" },
  });
  const next = query.get("next");
  const callbackURL =
    next?.startsWith("/") && !next.startsWith("//") && !next.includes("\\")
      ? next
      : "/dashboard";
  async function google() {
    setBusy(true);
    setNotice("");
    try {
      const r = await authClient.signIn.social({
        provider: "google",
        callbackURL,
        errorCallbackURL: `/login?${new URLSearchParams({ error: "oauth", next: callbackURL })}`,
      });
      if (r.error) setNotice(r.error.message ?? "Google sign-in failed");
    } catch {
      setNotice("Unable to reach Google sign-in. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function submit(values: z.infer<typeof schema>) {
    setBusy(true);
    setNotice("");
    try {
      const r = signup
        ? await authClient.signUp.email({
            ...values,
            name: values.name || values.email.split("@")[0]!,
            callbackURL,
          })
        : await authClient.signIn.email({
            email: values.email,
            password: values.password,
            callbackURL,
          });
      if (r.error) setNotice(r.error.message ?? "Unable to sign in");
      else if (signup)
        setNotice("Check your inbox to verify your email, then sign in.");
      else if (!(r.data && "redirect" in r.data && r.data.redirect))
        window.location.href = callbackURL;
    } catch {
      setNotice("Unable to reach the service. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-shell">
      <aside className="auth-aside">
        <Brand />
        <h1>
          A home base
          <br />
          for your agents.
        </h1>
        <p>Inboxes, phone numbers, and the tools to make things happen.</p>
        <small>PAPERS — INFRASTRUCTURE FOR INDEPENDENT AGENTS</small>
      </aside>
      <main className="auth-main">
        <div className="auth-box">
          <h2>{signup ? "Start your workspace." : "Welcome back."}</h2>
          <p>
            {signup
              ? "Give your agents a place in the world."
              : "Your agents have been expecting you."}
          </p>
          <button
            className="button google"
            onClick={google}
            disabled={busy || !ready}
          >
            <b style={{ fontSize: 18, color: "#4285f4" }}>G</b> Continue with
            Google
          </button>
          <div className="separator">or continue with email</div>
          <form
            method="post"
            data-auth-ready={ready}
            onSubmit={handleSubmit(submit)}
          >
            {signup && (
              <div className="field">
                <label htmlFor="name">Full name</label>
                <input id="name" autoComplete="name" {...register("name")} />
              </div>
            )}
            <div className="field">
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                {...register("email")}
              />
              <small>{errors.email?.message}</small>
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete={signup ? "new-password" : "current-password"}
                {...register("password")}
              />
              <small>{errors.password?.message}</small>
            </div>
            <button className="button full" disabled={busy || !ready}>
              {busy ? "Connecting…" : signup ? "Create account" : "Sign in"}
            </button>
          </form>
          {(notice || query.get("error")) && (
            <div role="status" className="notice">
              {notice || "Google sign-in did not complete. Please try again."}
            </div>
          )}
          <div className="auth-switch">
            {signup ? "Already have an account?" : "New to Papers?"}{" "}
            <button
              onClick={() => {
                setSignup(!signup);
                setNotice("");
              }}
            >
              {signup ? "Sign in" : "Create an account"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
export default function Page() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}
