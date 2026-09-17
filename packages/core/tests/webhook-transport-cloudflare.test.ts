import { expect, it, vi } from "vitest";
import { cloudflareWebhookTransport } from "../src/webhook-transport-cloudflare";
it("uses public fetch with only delivery headers, never follows redirects or consumes receiver bodies", async () => {
  const cancel = vi.fn();
  const fetcher = vi.fn(
    async () =>
      new Response(new ReadableStream({ cancel }), {
        status: 302,
        headers: { location: "https://private.internal/secret" },
      }),
  );
  const transport = cloudflareWebhookTransport(fetcher);
  const signal = AbortSignal.timeout(1000);
  expect(
    await transport({
      url: "https://hooks.customer.com/events",
      body: "{}",
      signal,
      headers: {
        "webhook-id": "delivery",
        "webhook-timestamp": "123",
        "webhook-signature": "v1,signature",
        Authorization: "never forwarded",
        Cookie: "never forwarded",
      },
    }),
  ).toBe(302);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith("https://hooks.customer.com/events", {
    method: "POST",
    body: "{}",
    signal,
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      "webhook-id": "delivery",
      "webhook-timestamp": "123",
      "webhook-signature": "v1,signature",
    },
  });
  expect(cancel).toHaveBeenCalledTimes(1);
});
it("rejects unsafe URLs and aborted work before calling the network", async () => {
  const fetcher = vi.fn();
  const transport = cloudflareWebhookTransport(fetcher);
  for (const url of [
    "http://hooks.customer.com",
    "https://127.0.0.1",
    "https://name:secret@hooks.customer.com",
  ]) {
    await expect(
      transport({
        url,
        body: "{}",
        headers: {},
        signal: AbortSignal.timeout(1000),
      }),
    ).rejects.toThrow();
  }
  await expect(
    transport({
      url: "https://hooks.customer.com",
      body: "{}",
      headers: {},
      signal: AbortSignal.abort(),
    }),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it("media transport sends no credentials and leaves redirects for the bounded downloader to reject", async () => {
  const { cloudflareMediaTransport } =
    await import("../src/webhook-transport-cloudflare");
  const fetcher = vi.fn(async () => new Response(null, { status: 302 }));
  const transport = cloudflareMediaTransport(fetcher);
  const signal = AbortSignal.timeout(1000);
  expect(
    (await transport("https://media.customer.com/file", signal)).status,
  ).toBe(302);
  expect(fetcher).toHaveBeenCalledWith("https://media.customer.com/file", {
    signal,
    redirect: "manual",
  });
});
