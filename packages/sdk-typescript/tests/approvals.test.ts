import { expect, it, vi } from "vitest";
import { Papers, PapersError } from "../src/index";
it("lists approvals and preserves only safe approval metadata on failed sends", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ data: [], policyVersion: 1 }))
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: "approval_required",
            message: "Review required",
            details: { approvalId: "approval", extra: "not exposed" },
          },
        },
        { status: 409 },
      ),
    );
  const sdk = new Papers({
    apiKey: "fixture",
    baseUrl: "https://papers.test",
    fetch: fetcher,
  });
  expect(await sdk.approvals.list("older/+", 10)).toEqual({ data: [], policyVersion: 1 });
  await expect(
    sdk.request(
      "/phone-numbers/number/messages",
      "POST",
      { to: "+12025550100", text: "test" },
      { idempotencyKey: "send" },
    ),
  ).rejects.toMatchObject({
    code: "approval_required",
    details: { approvalId: "approval" },
  });
  expect(fetcher.mock.calls[0]?.[0].toString()).toContain("/v1/approvals?cursor=older%2F%2B&limit=10");
});
