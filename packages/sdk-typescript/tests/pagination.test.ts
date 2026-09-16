import { expect, it, vi } from "vitest";
import { Papers } from "../src/index";

it.each(["sms", "events", "inboxes", "numbers"] as const)(
  "iterates %s with an explicit starting cursor and page size",
  async (kind) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "one" }], nextCursor: "one" }),
      )
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "two" }], nextCursor: "two" }),
      )
      .mockResolvedValueOnce(Response.json({ data: [], nextCursor: null }));
    const client = new Papers({ apiKey: "test", fetch: fetcher });
    const options = { cursor: "saved/position", limit: 2 };
    const iterator =
      kind === "sms"
        ? client.iterateSms("number/id", options)
        : kind === "inboxes"
          ? client.iterateInboxes(options)
          : kind === "numbers"
            ? client.iteratePhoneNumbers(options)
            : client.iterateEvents(options);
    const ids = [];
    for await (const item of iterator) ids.push(item.id);
    expect(ids).toEqual(["one", "two"]);
    const first = new URL(String(fetcher.mock.calls[0]![0]));
    expect(first.pathname).toBe(
      kind === "sms"
        ? "/v1/phone-numbers/number%2Fid/messages"
        : kind === "inboxes"
          ? "/v1/inboxes"
          : kind === "numbers"
            ? "/v1/phone-numbers"
            : "/v1/events",
    );
    expect(first.searchParams.get("cursor")).toBe("saved/position");
    expect(first.searchParams.get("limit")).toBe("2");
    expect(fetcher).toHaveBeenCalledTimes(3);
  },
);

it("stops a cyclic pagination response without making requests forever", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ data: [{ id: "one" }], nextCursor: "one" }),
    )
    .mockResolvedValueOnce(
      Response.json({ data: [{ id: "two" }], nextCursor: "two" }),
    )
    .mockResolvedValueOnce(
      Response.json({ data: [{ id: "three" }], nextCursor: "one" }),
    );
  const client = new Papers({ apiKey: "test", fetch: fetcher });
  for await (const _ of client.iterateMessages("inbox")) {
    /* drain */
  }
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it.each([0, 101, -1, 1.5, NaN, Infinity])(
  "rejects invalid page size %s before making requests",
  (limit) => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new Papers({ apiKey: "test", fetch: fetcher });
    expect(() => client.events.list(undefined, limit)).toThrow(RangeError);
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it.each([
  [502, "<html>private upstream details</html>", "http_error"],
  [200, "not json", "invalid_response"],
  [200, "[]", "invalid_response"],
  [403, '{"error":"forbidden"}', "http_error"],
] as const)(
  "handles malformed response %s safely",
  async (status, body, code) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(body, { status, headers: { "X-Request-Id": "trace" } }),
      );
    const client = new Papers({ apiKey: "test", fetch: fetcher });
    await expect(client.capabilities()).rejects.toMatchObject({
      name: "PapersError",
      status,
      code,
      requestId: "trace",
      retryable: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it("preserves retry hints without resending and supports empty successful responses", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: "unavailable",
            message: "Unavailable",
            retryable: true,
          },
        },
        { status: 503 },
      ),
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  const client = new Papers({ apiKey: "test", fetch: fetcher });
  await expect(
    client.sms.send(
      "number",
      { to: "+12025550101", text: "Hello" },
      { idempotencyKey: "stable" },
    ),
  ).rejects.toMatchObject({ retryable: true });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(client.request<void>("/empty")).resolves.toBeUndefined();
});
