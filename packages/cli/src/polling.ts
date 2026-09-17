import { setTimeout as delay } from "node:timers/promises";
import type { Event, Operation, Page } from "@papers.bot/sdk";
export function positiveInteger(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1)
    throw new Error("Expected a positive integer");
  return number;
}
export async function* watchEvents(
  list: (cursor?: string) => Promise<Page<Event>>,
  options: { cursor?: string; intervalMs: number; signal: AbortSignal },
) {
  let cursor = options.cursor;
  while (!options.signal.aborted) {
    const page = await list(cursor);
    if (options.signal.aborted) return;
    for (const event of page.data) {
      if (event.id === cursor) continue;
      cursor = event.id;
      yield { event, cursor };
    }
    // An empty poll must retain the last checkpoint.
    cursor = page.nextCursor ?? cursor;
    try {
      await delay(options.intervalMs, undefined, { signal: options.signal });
    } catch (error) {
      if (options.signal.aborted) return;
      throw error;
    }
  }
}
export async function waitForOperation(
  get: () => Promise<Operation>,
  options: { intervalMs: number; timeoutMs: number; signal: AbortSignal },
) {
  const deadline = Date.now() + options.timeoutMs;
  while (true) {
    options.signal.throwIfAborted();
    const operation = await get();
    options.signal.throwIfAborted();
    if (["completed", "failed"].includes(operation.status)) return operation;
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new Error(
        `Operation ${operation.id} remains ${operation.status}. Poll it again; do not resend with a new idempotency key.`,
      );
    await delay(Math.min(remaining, options.intervalMs), undefined, {
      signal: options.signal,
    });
  }
}
