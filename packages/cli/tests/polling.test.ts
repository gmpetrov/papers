import { it, expect, vi } from "vitest";
import { watchEvents, waitForOperation, positiveInteger } from "../src/polling";
import type { Event } from "@papers.bot/sdk";
const event = (id: string): Event => ({
  id,
  type: "email.received",
  resourceId: "message",
  createdAt: new Date().toISOString(),
});
it("retains the event cursor across empty polls and stops when interrupted", async () => {
  const controller = new AbortController();
  const list = vi
    .fn()
    .mockResolvedValueOnce({ data: [event("a")], nextCursor: "a" })
    .mockResolvedValueOnce({ data: [], nextCursor: null })
    .mockResolvedValueOnce({ data: [event("b")], nextCursor: "b" });
  const stream = watchEvents(list, {
    cursor: "start",
    intervalMs: 1,
    signal: controller.signal,
  });
  expect((await stream.next()).value?.cursor).toBe("a");
  expect((await stream.next()).value?.cursor).toBe("b");
  expect(list.mock.calls).toEqual([["start"], ["a"], ["a"]]);
  controller.abort();
  expect((await stream.next()).done).toBe(true);
});
it("polls unknown outcomes until completed without retrying a mutation", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({ id: "op", status: "unknown" })
    .mockResolvedValueOnce({ id: "op", status: "completed" });
  expect(
    await waitForOperation(get, {
      intervalMs: 1,
      timeoutMs: 1000,
      signal: new AbortController().signal,
    }),
  ).toEqual({ id: "op", status: "completed" });
  expect(get).toHaveBeenCalledTimes(2);
});
it("returns failed operations and gives actionable timeout guidance", async () => {
  const signal = new AbortController().signal;
  expect(
    (
      await waitForOperation(async () => ({ id: "op", status: "failed" }), {
        intervalMs: 1,
        timeoutMs: 100,
        signal,
      })
    ).status,
  ).toBe("failed");
  await expect(
    waitForOperation(async () => ({ id: "op", status: "unknown" }), {
      intervalMs: 1,
      timeoutMs: 0,
      signal,
    }),
  ).rejects.toThrow("do not resend");
});
it("rejects invalid polling intervals", () => {
  for (const input of ["0", "-1", "1.5", "NaN", "Infinity"])
    expect(() => positiveInteger(input)).toThrow();
  expect(positiveInteger("2")).toBe(2);
});
