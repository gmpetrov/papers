import { describe, expect, it, vi } from "vitest";
import { Papers, PapersError } from "../src/index";

describe("TypeScript client", () => {
  it("preserves field validation details and drops unexpected metadata", async () => {
    const details = [
      {
        code: "invalid_format",
        path: ["to", 0],
        message: "Invalid email",
        input: "private input",
      },
    ];
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "validation_error",
            message: "Check fields",
            retryable: false,
            details,
          },
        },
        { status: 400 },
      ),
    );
    const client = new Papers({ apiKey: "test", fetch: fetcher });
    const error = await client.inboxes.list().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(PapersError);
    expect((error as PapersError).code).toBe("validation_error");
    expect((error as PapersError).details).toEqual([
      { code: "invalid_format", path: ["to", 0], message: "Invalid email" },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not expose malformed validation details", async () => {
    const client = new Papers({
      apiKey: "test",
      fetch: async () =>
        Response.json(
          {
            error: {
              code: "validation_error",
              message: "Check fields",
              details: [
                {
                  code: "invalid",
                  path: { private: "data" },
                  message: "Invalid",
                },
              ],
            },
          },
          { status: 400 },
        ),
    });
    await expect(client.inboxes.list()).rejects.toMatchObject({
      details: undefined,
    });
  });
  it("encodes resource IDs and preserves reply idempotency", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ id: "operation", status: "unknown" }, { status: 202 }),
      );
    const client = new Papers({
      apiKey: "test",
      baseUrl: "https://example.test/",
      fetch: fetcher,
    });
    const result = await client.messages.reply(
      "message/other",
      { text: "Reply" },
      { idempotencyKey: "stable" },
    );
    expect(result.status).toBe("unknown");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://example.test/v1/messages/message%2Fother/reply",
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer test", "Idempotency-Key": "stable" },
      body: JSON.stringify({ text: "Reply" }),
    });
  });

  it("preserves structured errors without retrying a denied request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "recipient_not_allowed",
            message: "Denied",
            request_id: "request",
            retryable: false,
          },
        },
        { status: 403 },
      ),
    );
    const client = new Papers({ apiKey: "test", fetch: fetcher });
    await expect(
      client.messages.reply(
        "message",
        { text: "Reply" },
        { idempotencyKey: "stable" },
      ),
    ).rejects.toMatchObject({
      name: "PapersError",
      status: 403,
      code: "recipient_not_allowed",
      requestId: "request",
      retryable: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("iterates all message pages and stops on a null cursor", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "first" }], nextCursor: "cursor" }),
      )
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "second" }], nextCursor: null }),
      );
    const client = new Papers({ apiKey: "test", fetch: fetcher });
    const ids = [];
    for await (const message of client.iterateMessages("inbox"))
      ids.push(message.id);
    expect(ids).toEqual(["first", "second"]);
    expect(String(fetcher.mock.calls[1]?.[0])).toContain("?cursor=cursor");
  });
});

it("archives and reactivates the same encoded inbox without creating a new resource", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (_url, init) =>
      Response.json(JSON.parse(init?.body as string)),
    );
  const client = new Papers({ apiKey: "fixture", fetch: fetcher });
  expect(await client.inboxes.archive("inbox/id")).toEqual({
    status: "archived",
  });
  expect(await client.inboxes.reactivate("inbox/id")).toEqual({
    status: "active",
  });
  expect(
    fetcher.mock.calls.every(
      ([url, init]) =>
        String(url).endsWith("/v1/inboxes/inbox%2Fid") &&
        init?.method === "PATCH",
    ),
  ).toBe(true);
});

it.each([
  ["17", 17],
  ["-1", undefined],
  ["invalid", undefined],
  ["9007199254740992", undefined],
])(
  "preserves safe Retry-After delay %s without retrying",
  async (header, seconds) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { error: { code: "rate_limited", message: "Wait", retryable: true } },
          { status: 429, headers: { "Retry-After": String(header) } },
        ),
      );
    const sdk = new Papers({ apiKey: "fixture", fetch: fetcher });
    await expect(sdk.capabilities()).rejects.toMatchObject({
      code: "rate_limited",
      retryable: true,
      retryAfterSeconds: seconds,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
