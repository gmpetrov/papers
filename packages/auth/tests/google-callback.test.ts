import { afterAll, expect, it } from "vitest";
import { createDatabase } from "@agentinfra/db";
import { createAuth } from "../src/index";

const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_test",
);
const origin = "http://localhost:3000";
const auth = createAuth(db, {
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: "google-callback-test-secret-long-enough",
  GOOGLE_CLIENT_ID: "fixture-google-client",
  GOOGLE_CLIENT_SECRET: "fixture-google-secret",
});
afterAll(() => db.$disconnect());

it("returns canceled Google authorization to the login page with the original invitation destination", async () => {
  const sessionsBefore = await db.session.count();
  const usersBefore = await db.user.count();
  const next = "/invite/fixture-invitation";
  const errorCallbackURL = `/login?${new URLSearchParams({ error: "oauth", next })}`;
  const start = await auth.handler(
    new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "google",
        callbackURL: next,
        errorCallbackURL,
        disableRedirect: true,
      }),
    }),
  );
  expect(start.status).toBe(200);
  const target = new URL((await start.json()).url);
  expect(target.hostname).toBe("accounts.google.com");
  const state = target.searchParams.get("state");
  expect(state).toBeTruthy();
  const cookie = start.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const callback = await auth.handler(
    new Request(
      `${origin}/api/auth/callback/google?${new URLSearchParams({ error: "access_denied", state: state! })}`,
      { headers: { Cookie: cookie } },
    ),
  );
  expect(callback.status).toBe(302);
  const redirect = new URL(callback.headers.get("location")!, origin);
  expect(redirect.origin).toBe(origin);
  expect(redirect.pathname).toBe("/login");
  expect(redirect.searchParams.get("next")).toBe(next);
  expect(redirect.searchParams.has("error")).toBe(true);
  expect(await db.session.count()).toBe(sessionsBefore);
  expect(await db.user.count()).toBe(usersBefore);
});

it("rejects forged Google callbacks without creating a session", async () => {
  const sessionsBefore = await db.session.count();
  const response = await auth.handler(
    new Request(
      `${origin}/api/auth/callback/google?error=access_denied&state=forged-state`,
    ),
  );
  expect(response.status).toBe(302);
  const redirect = new URL(response.headers.get("location")!, origin);
  expect(redirect.origin).toBe(origin);
  expect(redirect.searchParams.has("error")).toBe(true);
  expect(await db.session.count()).toBe(sessionsBefore);
});
