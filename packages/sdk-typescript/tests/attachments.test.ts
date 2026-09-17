import { expect, it, vi } from "vitest";
import { Papers } from "../src/index";

it("downloads exact binary bytes with authentication and encoded IDs", async () => {
  const bytes = new Uint8Array([0, 255, 128, 10]);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(bytes, {
      headers: { "Content-Type": "application/octet-stream" },
    }),
  );
  const client = new Papers({ apiKey: "test", fetch: fetcher });
  expect(await client.attachments.download("file/id")).toEqual(bytes);
  expect(
    String(fetcher.mock.calls[0]![0]).endsWith(
      "/v1/attachments/file%2Fid/download",
    ),
  ).toBe(true);
  expect(fetcher.mock.calls[0]![1]).toMatchObject({
    headers: { Authorization: "Bearer test" },
    redirect: "error",
  });
});

it("cancels oversized streaming bodies even without a content length", async () => {
  const cancelled = vi.fn();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
    },
    cancel: cancelled,
  });
  const client = new Papers({
    apiKey: "test",
    fetch: vi.fn<typeof fetch>().mockResolvedValue(
      new Response(stream, {
        headers: { "Content-Type": "application/octet-stream" },
      }),
    ),
  });
  await expect(
    client.attachments.download("file", { maxBytes: 2 }),
  ).rejects.toMatchObject({ code: "attachment_too_large" });
  expect(cancelled).toHaveBeenCalledTimes(1);
});

it("preserves pending and unauthorized download errors without retrying", async () => {
  for (const status of [401, 409]) {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "attachment_not_ready",
            message: "Not ready",
            request_id: "trace",
          },
        },
        { status },
      ),
    );
    const client = new Papers({ apiKey: "test", fetch: fetcher });
    await expect(client.attachments.download("file")).rejects.toMatchObject({
      status,
      requestId: "trace",
      code: "attachment_not_ready",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});

it("rejects invalid size limits before requesting and handles zero-byte files", async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(
    async () =>
      new Response(new Uint8Array(), {
        headers: { "Content-Type": "application/octet-stream" },
      }),
  );
  const client = new Papers({ apiKey: "test", fetch: fetcher });
  await expect(
    client.attachments.download("file", { maxBytes: -1 }),
  ).rejects.toThrow(RangeError);
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    await client.attachments.download("file", { maxBytes: 0 }),
  ).toHaveLength(0);
});

it("cancels an unexpected successful response without consuming it", async () => {
  const cancelled = vi.fn();
  const client = new Papers({
    apiKey: "test",
    fetch: vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new ReadableStream({ cancel: cancelled }), {
        headers: { "Content-Type": "text/html" },
      }),
    ),
  });
  await expect(client.attachments.download("file")).rejects.toMatchObject({
    code: "invalid_response",
  });
  expect(cancelled).toHaveBeenCalledTimes(1);
});

it("forwards attachment bytes on email sends, replies, and MMS", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      Response.json({ id: "op", status: "completed" }),
    );
  const client = new Papers({ apiKey: "test", fetch: fetcher });
  const attachments = [
    { filename: "image.png", contentType: "image/png", content: "AAE=" },
  ];
  const options = { idempotencyKey: "same" };
  await client.messages.send(
    "inbox",
    { to: ["a@example.test"], subject: "Files", text: "Hi", attachments },
    options,
  );
  await client.messages.reply("message", { text: "Hi", attachments }, options);
  await client.sms.send(
    "phone",
    { to: "+12025550100", text: "Hi", attachments },
    options,
  );
  expect(fetcher).toHaveBeenCalledTimes(3);
  for (const [, init] of fetcher.mock.calls)
    expect(JSON.parse(init!.body as string).attachments).toEqual(attachments);
});
