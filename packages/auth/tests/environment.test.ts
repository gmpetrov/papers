import { expect, it } from "vitest";
import { resolveAuthEnvironment } from "../src/environment";

it("loads the dev origin and Google provider from Cloudflare bindings without a Node env loader", () => {
  const bindings = {
    BETTER_AUTH_URL: "https://dev.chaindesk.ai",
    BETTER_AUTH_SECRET: "fixture-auth-secret",
    GOOGLE_CLIENT_ID: "fixture-google-client",
    GOOGLE_CLIENT_SECRET: "fixture-google-secret",
  };
  expect(resolveAuthEnvironment(bindings, {})).toMatchObject(bindings);
});

it("uses deployment bindings instead of stale build-time auth settings", () => {
  expect(
    resolveAuthEnvironment(
      {
        BETTER_AUTH_URL: "https://www.papers.bot",
        BETTER_AUTH_SECRET: "runtime-secret",
        GOOGLE_CLIENT_ID: "runtime-client",
      },
      {
        BETTER_AUTH_URL: "http://localhost:3000",
        BETTER_AUTH_SECRET: "build-secret",
        GOOGLE_CLIENT_ID: "build-client",
      },
    ),
  ).toMatchObject({
    BETTER_AUTH_URL: "https://www.papers.bot",
    BETTER_AUTH_SECRET: "runtime-secret",
    GOOGLE_CLIENT_ID: "runtime-client",
  });
});

it("preserves Node-only configuration and refuses to run without an auth secret", () => {
  expect(
    resolveAuthEnvironment(
      {},
      { BETTER_AUTH_SECRET: "local-secret", GOOGLE_CLIENT_ID: "local-client" },
    ),
  ).toMatchObject({
    BETTER_AUTH_URL: "http://localhost:3000",
    GOOGLE_CLIENT_ID: "local-client",
  });
  expect(() => resolveAuthEnvironment({}, {})).toThrow(
    "BETTER_AUTH_SECRET is required",
  );
});
