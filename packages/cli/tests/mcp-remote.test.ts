import { expect, it, vi } from "vitest";
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/server", () => ({
  withRuntime: (run: (runtime: unknown) => unknown) =>
    run({
      mcpApi: { fetch: api },
      auth: { options: { baseURL: "https://papers.test" } },
    }),
}));
import { POST } from "../../../apps/web/src/app/mcp/route";

it("preserves structured approval errors and request identity through remote MCP", async () => {
  api.mockImplementation(async (request: Request) => {
    expect(request.headers.get("authorization")).toBe("Bearer caller-token");
    expect(request.headers.get("cookie")).toBeNull();
    if (new URL(request.url).pathname === "/v1/me")
      return Response.json({ scopes: ["sms:send"] });
    expect(request.redirect).toBe("manual");
    expect(new URL(request.url).pathname).toBe(
      "/v1/phone-numbers/phone/messages",
    );
    expect(request.headers.get("idempotency-key")).toBe("original-key");
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(request.headers.get("origin")).toBe("https://papers.test");
    expect(await request.json()).toEqual({
      to: "+12025550100",
      text: "Review me",
    });
    return Response.json(
      {
        error: {
          code: "approval_required",
          message: "Review required",
          details: { approvalId: "approval-123", internal: "must not leak" },
        },
      },
      { status: 409 },
    );
  });
  const response = await POST(
    new Request("https://papers.test/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer caller-token",
        cookie: "session=excluded",
        origin: "https://papers.test",
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "send_sms",
          arguments: {
            phoneNumberId: "phone",
            to: "+12025550100",
            text: "Review me",
            idempotencyKey: "original-key",
          },
        },
      }),
    }),
  );
  const { result } = await response.json();
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toEqual({
    error: {
      code: "approval_required",
      message: "Review required",
      details: { approvalId: "approval-123" },
    },
  });
  expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
  expect(api).toHaveBeenCalledTimes(2);
});

it("allows email-only credentials to list their approval requests through remote MCP", async () => {
  api.mockReset().mockImplementation(async (request: Request) => {
    if (new URL(request.url).pathname === "/v1/me") return Response.json({ scopes: ["email:send"] });
    expect(new URL(request.url).pathname).toBe("/v1/approvals");
    return Response.json({ data: [], nextCursor: null, policyVersion: 1 });
  });
  const response = await POST(new Request("https://papers.test/mcp", {
    method: "POST", headers: { Authorization: "Bearer email-only", "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_approvals", arguments: {} } }),
  }));
  const { result } = await response.json();
  expect(result.isError).toBeUndefined();
  expect(result.structuredContent.data).toEqual({ data: [], nextCursor: null, policyVersion: 1 });
});
