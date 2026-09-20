import { expect, it, vi } from "vitest";
import { handleMcp, toolScopes } from "../../../apps/mcp/src/index";
import { PapersError } from "../../sdk-typescript/src/index";

it("creates an inbox through MCP with only a username", async () => {
  const inbox = {
    id: "inbox",
    name: "fierce-zebra",
    address: "research@example.test",
  };
  const call = vi.fn().mockResolvedValue(inbox);
  const response = await handleMcp(
    request("create_inbox", { username: "research" }),
    call,
  );
  const { result } = await response.json();
  expect(result.isError).toBeUndefined();
  expect(call).toHaveBeenCalledExactlyOnceWith("/inboxes", "POST", {
    username: "research",
  });
  expect(result.structuredContent.data).toEqual(inbox);
});

function request(name: string, args: Record<string, unknown>) {
  return new Request("https://papers.test/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
}
it("returns safe structured validation issues so an MCP client can repair its request", async () => {
  const details = [
    { code: "invalid_format", path: ["to", 0], message: "Invalid email" },
  ];
  const call = vi
    .fn()
    .mockRejectedValue(
      new PapersError(
        400,
        "validation_error",
        "Check fields",
        "request",
        false,
        details,
      ),
    );
  const response = await handleMcp(request("list_inboxes", {}), call);
  const { result } = await response.json();
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toEqual({
    error: { code: "validation_error", message: "Check fields", details },
  });
  expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
  expect(call).toHaveBeenCalledTimes(1);
});
it("preserves event pages and cursor checkpoints in MCP tool results", async () => {
  const page = {
    data: [{ id: "event", type: "sms.received", resourceId: "message" }],
    nextCursor: "event",
  };
  const call = vi
    .fn()
    .mockResolvedValueOnce(page)
    .mockResolvedValueOnce({ data: [], nextCursor: null });
  const result = (
    await (
      await handleMcp(
        request("list_events", { cursor: "prior/+&", limit: 1 }),
        call,
      )
    ).json()
  ).result;
  expect(result.structuredContent.data).toEqual(page);
  expect(JSON.parse(result.content[0].text)).toEqual(page);
  expect(call).toHaveBeenLastCalledWith(
    "/events?cursor=prior%2F%2B%26&limit=1",
  );
  const empty = (
    await (
      await handleMcp(request("list_events", { cursor: "event" }), call)
    ).json()
  ).result;
  expect(empty.structuredContent.data).toEqual({ data: [], nextCursor: null });
  expect(call).toHaveBeenCalledTimes(2);
  expect(toolScopes.list_events).toBe("events:read");
});

it("encodes email and SMS page parameters and validates every page limit", async () => {
  for (const [name, args, path] of [
    ["list_messages", { inboxId: "inbox/id" }, "/inboxes/inbox%2Fid/messages"],
    [
      "list_sms",
      { phoneNumberId: "number/id" },
      "/phone-numbers/number%2Fid/messages",
    ],
    ["list_events", {}, "/events"],
    ["list_approvals", {}, "/approvals"],
  ] as const) {
    const call = vi.fn().mockResolvedValue({ data: [], nextCursor: null });
    await handleMcp(
      request(name, { ...args, cursor: "a+b", limit: 100 }),
      call,
    );
    expect(call).toHaveBeenLastCalledWith(`${path}?cursor=a%2Bb&limit=100`);
    for (const limit of [0, -1, 101, 1.5, "10"]) {
      const response = await (
        await handleMcp(request(name, { ...args, limit }), call)
      ).json();
      expect(response.result?.isError || response.error).toBeTruthy();
    }
    expect(call).toHaveBeenCalledTimes(1);
  }
});

it("returns event permission failures without retrying", async () => {
  const call = vi
    .fn()
    .mockRejectedValue(new Error("Missing scope: events:read"));
  const response = await (
    await handleMcp(request("list_events", {}), call)
  ).json();
  expect(response.result.isError).toBe(true);
  expect(call).toHaveBeenCalledTimes(1);
});

it("exposes approval listing without a tool for self-approval", async () => {
  const data = {
    data: [{ id: "approval", status: "pending" }],
    policyVersion: 1,
  };
  const call = vi.fn().mockResolvedValue(data);
  const result = (
    await (await handleMcp(request("list_approvals", {}), call)).json()
  ).result;
  expect(result.structuredContent.data).toEqual(data);
  expect(call).toHaveBeenCalledWith("/approvals");
  expect(toolScopes.list_approvals).toEqual([
    "sms:send",
    "email:send",
    "inboxes:write",
    "numbers:provision",
  ]);
  expect(toolScopes.approve_action).toBeUndefined();
});

it.each([
  ["list_inboxes", "/inboxes"],
  ["list_phone_numbers", "/phone-numbers"],
])("forwards resource pagination through %s", async (tool, path) => {
  const call = vi
    .fn()
    .mockResolvedValue({ data: [{ id: "item" }], nextCursor: "next" });
  const response = await handleMcp(
    request(tool!, { cursor: "prior/+&", limit: 2 }),
    call,
  );
  const result = (await response.json()).result;
  expect(result.isError).toBeUndefined();
  expect(call).toHaveBeenCalledWith(`${path}?cursor=prior%2F%2B%26&limit=2`);
  expect(result.structuredContent.data.nextCursor).toBe("next");
});

it("exposes identity and remaining allowance without executing a mutation", async () => {
  const identity = {
    organizationId: "workspace",
    scopes: ["email:send"],
    sendLimits: {
      email: { dailyLimit: 2, remaining: 1, approvalRequired: true },
    },
  };
  const call = vi.fn().mockResolvedValue(identity);
  const result = (
    await (await handleMcp(request("get_identity", {}), call)).json()
  ).result;
  expect(call).toHaveBeenCalledExactlyOnceWith("/me");
  expect(result.structuredContent.data).toEqual(identity);
});

it("exposes reversible inbox lifecycle operations with the existing write scope", async () => {
  const call = vi.fn().mockResolvedValue({ status: "archived" });
  const response = await handleMcp(
    request("set_inbox_status", {
      inboxId: "inbox/with spaces",
      status: "archived",
    }),
    call,
  );
  expect((await response.json()).result.structuredContent.data).toEqual({
    status: "archived",
  });
  expect(call).toHaveBeenCalledWith("/inboxes/inbox%2Fwith%20spaces", "PATCH", {
    status: "archived",
  });
  expect(toolScopes.set_inbox_status).toBe("inboxes:write");
  const invalid = await handleMcp(
    request("set_inbox_status", { inboxId: "inbox", status: "deleted" }),
    call,
  );
  const body = await invalid.json();
  expect(Boolean(body.error || body.result?.isError)).toBe(true);
  expect(call).toHaveBeenCalledTimes(1);
});

it("returns retry timing on throttled MCP tool calls without replaying them", async () => {
  const call = vi
    .fn()
    .mockRejectedValue(
      new PapersError(
        429,
        "rate_limited",
        "Wait",
        "request",
        true,
        undefined,
        12,
      ),
    );
  const { result } = await (
    await handleMcp(request("list_inboxes", {}), call)
  ).json();
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toEqual({
    error: {
      code: "rate_limited",
      message: "Wait",
      retryable: true,
      retryAfterSeconds: 12,
    },
  });
  expect(call).toHaveBeenCalledTimes(1);
});
