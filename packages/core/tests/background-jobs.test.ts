import { it, expect, vi } from "vitest";
import type { Database } from "@agentinfra/db";
import { runBackgroundJobs } from "../src/background-jobs";
const lanes = vi.hoisted(() => ({
  request_limits: vi.fn(),
  resend: vi.fn(),
  telnyx: vi.fn(),
  numbers: vi.fn(),
  sms: vi.fn(),
  sms_opt_outs: vi.fn(),
  attachments: vi.fn(),
}));
vi.mock("../src/request-limits", () => ({
  pruneRequestBuckets: lanes.request_limits,
}));
vi.mock("../src/webhooks", () => ({ processProviderEvents: lanes.resend }));
vi.mock("../src/telnyx-webhooks", () => ({
  processTelnyxEvents: lanes.telnyx,
}));
vi.mock("../src/phone-numbers", () => ({
  reconcilePhoneNumbers: lanes.numbers,
}));
vi.mock("../src/sms-opt-out-sync", () => ({
  reconcileSmsOptOuts: lanes.sms_opt_outs,
}));
vi.mock("../src/sms-reconciliation", () => ({ reconcileSmsSends: lanes.sms }));
vi.mock("../src/attachments", () => ({
  processAttachments: lanes.attachments,
}));

it("continues independent job lanes after failure without exposing exception details", async () => {
  const order: string[] = [];
  for (const [name, run] of Object.entries(lanes))
    run.mockImplementation(async () => {
      order.push(name);
      if (name === "resend" || name === "sms")
        throw new Error("PRIVATE_PROVIDER_DETAILS");
      return { processed: 1 };
    });
  const result = await runBackgroundJobs({} as Database, {});
  expect(order).toEqual([
    "request_limits",
    "resend",
    "telnyx",
    "numbers",
    "sms",
    "sms_opt_outs",
    "attachments",
  ]);
  expect(result.failed).toEqual(["resend", "sms"]);
  expect(result.results.telnyx).toEqual({ processed: 1 });
  expect(result.results.attachments).toEqual({ processed: 1 });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_PROVIDER_DETAILS");
});
