import { it, expect, vi } from "vitest";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { CliAuth } from "../src/auth";
it("uses PKCE/state, saves private credentials, rotates tokens and revokes on logout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "papers-auth-"));
  let authorization: URL;
  const forms: URLSearchParams[] = [];
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (input, init) => {
      if (String(input).endsWith("/register")) {
        expect(
          JSON.parse(init?.body as string).token_endpoint_auth_method,
        ).toBe("none");
        return Response.json({ client_id: "client" });
      }
      const form = new URLSearchParams(init?.body as URLSearchParams);
      forms.push(form);
      if (String(input).endsWith("/revoke"))
        return new Response(null, { status: 200 });
      if (form.get("grant_type") === "authorization_code") {
        expect(
          createHash("sha256")
            .update(form.get("code_verifier")!)
            .digest("base64url"),
        ).toBe(authorization.searchParams.get("code_challenge"));
        expect(form.get("resource")).toBe("https://papers.example/v1");
        return Response.json({
          token_type: "Bearer",
          access_token: "first",
          refresh_token: "refresh-one",
          expires_in: 1,
          scope: "inboxes:read offline_access",
        });
      }
      expect(form.get("refresh_token")).toBe("refresh-one");
      return Response.json({
        token_type: "Bearer",
        access_token: "second",
        refresh_token: "refresh-two",
        expires_in: 900,
      });
    });
  const auth = new CliAuth("https://papers.example", directory, fetcher);
  let callback: Promise<void> | undefined;
  try {
    const result = await auth.login({
      signal: AbortSignal.timeout(5000),
      scope: "inboxes:read offline_access",
      onUrl: (url) => {
        authorization = new URL(url);
        callback = (async () => {
          const returned = new URL(
            authorization.searchParams.get("redirect_uri")!,
          );
          returned.searchParams.set("code", "code");
          returned.searchParams.set("state", "invalid");
          expect((await fetch(returned)).status).toBe(400);
          returned.searchParams.set(
            "state",
            authorization.searchParams.get("state")!,
          );
          expect((await fetch(returned)).status).toBe(200);
        })();
      },
    });
    await callback;
    expect(result.loggedIn).toBe(true);
    expect((await stat(auth.path)).mode & 0o777).toBe(0o600);
    expect(await Promise.all([auth.token(), auth.token()])).toEqual([
      "second",
      "second",
    ]);
    expect(
      forms.filter((f) => f.get("grant_type") === "refresh_token"),
    ).toHaveLength(1);
    expect(JSON.parse(await readFile(auth.path, "utf8")).refreshToken).toBe(
      "refresh-two",
    );
    await auth.logout();
    expect(
      forms.filter((f) => f.has("token")).map((f) => f.get("token")),
    ).toEqual(["second", "refresh-two"]);
    await expect(auth.token()).rejects.toThrow("Run papers login");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("rejects unsafe origins and stops interrupted login before registration", async () => {
  for (const origin of [
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com/path",
  ])
    expect(() => new CliAuth(origin)).toThrow();
  const fetcher = vi.fn<typeof fetch>();
  const controller = new AbortController();
  controller.abort();
  await expect(
    new CliAuth("http://localhost:3000", undefined, fetcher).login({
      signal: controller.signal,
      onUrl: () => {},
    }),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
