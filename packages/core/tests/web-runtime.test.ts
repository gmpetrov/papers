import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  disconnect: vi.fn(async () => {}),
  createAuth: vi.fn(),
  createApi: vi.fn(() => ({})),
}));
vi.mock("@agentinfra/db/edge", () => ({
  createDatabase: () => ({ $disconnect: mocks.disconnect }),
}));
vi.mock("@agentinfra/auth", () => ({
  createAuth: mocks.createAuth,
  resolveAuthEnvironment: () => ({}),
}));
vi.mock("@agentinfra/core", () => ({ createApi: mocks.createApi }));
vi.mock("../../../apps/web/node_modules/@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: { HYPERDRIVE: { connectionString: "unused" }, ATTACHMENTS: {} },
  }),
}));
import { withRuntime } from "../../../apps/web/src/lib/server";

beforeEach(() => vi.clearAllMocks());

it("does not initialize OAuth or its database queries for database-only routes", async () => {
  await withRuntime(async (r) => {
    expect(r.db).toBeDefined();
    return "webhook accepted";
  });
  expect(mocks.createAuth).not.toHaveBeenCalled();
  expect(mocks.createApi).not.toHaveBeenCalled();
  expect(mocks.disconnect).toHaveBeenCalledOnce();
});

it("observes unused auth initialization failures and waits before disconnecting", async () => {
  let reject!: (error: Error) => void;
  const context = new Promise((_, fail) => {
    reject = fail;
  });
  mocks.createAuth.mockReturnValue({ $context: context, options: {} });
  const result = withRuntime(async (r) => {
    expect(r.auth).toBe(r.auth);
    return "response";
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(mocks.disconnect).not.toHaveBeenCalled();
  reject(new Error("planLimitReached"));
  expect(await result).toBe("response");
  expect(mocks.createAuth).toHaveBeenCalledOnce();
  expect(mocks.disconnect).toHaveBeenCalledOnce();
});

it("preserves auth failures for callers awaiting initialization", async () => {
  const failure = new Error("planLimitReached");
  mocks.createAuth.mockImplementation(() => ({
    $context: Promise.reject(failure),
    options: {},
  }));
  await expect(
    withRuntime(async (r) => {
      await r.auth.$context;
    }),
  ).rejects.toBe(failure);
  expect(mocks.disconnect).toHaveBeenCalledOnce();
});
