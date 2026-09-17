import { beforeEach, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import {
  publicWebhookLookup,
  isPublicWebhookAddress,
  nodeWebhookTransport,
} from "../src/webhook-transport-node";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
const resolveAddress = () =>
  new Promise((resolve, reject) =>
    publicWebhookLookup("hooks.customer.com", {}, (error, address, family) =>
      error ? reject(error) : resolve({ address, family }),
    ),
  );
it.each([
  "127.0.0.1",
  "10.0.0.1",
  "169.254.169.254",
  "172.16.0.1",
  "192.168.1.1",
  "100.64.0.1",
  "0.0.0.0",
  "224.0.0.1",
  "192.0.2.1",
  "198.18.0.1",
  "::1",
  "fc00::1",
  "fe80::1",
  "::ffff:127.0.0.1",
  "2001:db8::1",
  "64:ff9b::7f00:1",
  "invalid",
])("blocks nonpublic address %s", (address) => {
  expect(isPublicWebhookAddress(address)).toBe(false);
});
it("passes only a validated address from the connection lookup and rejects mixed DNS answers", async () => {
  vi.mocked(lookup).mockResolvedValueOnce([
    { address: "8.8.8.8", family: 4 },
  ] as never);
  await expect(resolveAddress()).resolves.toEqual({
    address: "8.8.8.8",
    family: 4,
  });
  expect(lookup).toHaveBeenCalledTimes(1);
  vi.mocked(lookup).mockResolvedValueOnce([
    { address: "8.8.8.8", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ] as never);
  await expect(resolveAddress()).rejects.toThrow("not public");
});
it("rejects unsafe URLs before resolving and rejects DNS rebinding to a private destination", async () => {
  const input = { body: "{}", headers: {}, signal: AbortSignal.timeout(1000) };
  await expect(
    nodeWebhookTransport({ ...input, url: "https://127.0.0.1/webhook" }),
  ).rejects.toThrow();
  expect(lookup).not.toHaveBeenCalled();
  vi.mocked(lookup).mockResolvedValueOnce([
    { address: "127.0.0.1", family: 4 },
  ] as never);
  await expect(
    nodeWebhookTransport({
      ...input,
      url: "https://hooks.customer.com/webhook",
    }),
  ).rejects.toThrow("Webhook request failed");
  expect(lookup).toHaveBeenCalledTimes(1);
});

it("media downloads reject literal private addresses and DNS rebinding", async () => {
  const { nodeMediaTransport } = await import("../src/webhook-transport-node");
  await expect(
    nodeMediaTransport("https://127.0.0.1/media", AbortSignal.timeout(1000)),
  ).rejects.toThrow();
  expect(lookup).not.toHaveBeenCalled();
  vi.mocked(lookup).mockResolvedValueOnce([
    { address: "127.0.0.1", family: 4 },
  ] as never);
  await expect(
    nodeMediaTransport(
      "https://media.customer.com/file",
      AbortSignal.timeout(1000),
    ),
  ).rejects.toThrow("Media download failed");
  expect(lookup).toHaveBeenCalledTimes(1);
});
