import { settleSms } from "./billing-ledger";
import type { Prisma } from "@agentinfra/db";
import { z } from "zod";
const usage = z.object({
  parts: z.number().int().min(1).max(10000).nullish().catch(undefined),
  cost: z
    .object({
      amount: z.string().regex(/^\d{1,10}(?:\.\d{1,10})?$/),
      currency: z.string().regex(/^[A-Z]{3}$/),
    })
    .nullish()
    .catch(null),
});

/** Provider cost is distinct from a customer charge. Missing values stay unknown.
 * Separate clocks let a late cost report enrich a message without regressing its
 * status or replacing newer segment data. No additive counters: replay is safe.
 */
export async function recordSmsUsage(
  tx: Prisma.TransactionClient,
  messageId: string,
  payload: unknown,
  occurredAt: Date,
  finalCost: boolean,
) {
  const parsed = usage.safeParse(payload);
  if (!parsed.success) return;
  const { parts, cost } = parsed.data;
  if (parts != null)
    await tx.smsMessage.updateMany({
      where: {
        id: messageId,
        OR: [
          { segmentsOccurredAt: null },
          { segmentsOccurredAt: { lt: occurredAt } },
        ],
      },
      data: { segments: parts, segmentsOccurredAt: occurredAt },
    });
  if (finalCost && cost)
    await tx.smsMessage.updateMany({
      where: {
        id: messageId,
        OR: [{ costOccurredAt: null }, { costOccurredAt: { lt: occurredAt } }],
      },
      data: {
        costAmount: cost.amount,
        costCurrency: cost.currency,
        costOccurredAt: occurredAt,
      },
    });
  if (finalCost) await settleSms(tx, messageId);
}
