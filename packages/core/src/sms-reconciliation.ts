import type { Database } from "@agentinfra/db";
import { z } from "zod";
import { confirmSmsSend } from "./sms-delivery";

const acceptedResult = z.object({
  providerMessageId: z.string().min(1),
  failure: z.object({ kind: z.literal("confirmation_failed") }),
});

/** Retry only the local confirmation of an already accepted provider response. */
export async function reconcileSmsSends(db: Database, limit = 10) {
  const cutoff = new Date(Date.now() - 60000);
  const candidates = await db.operation.findMany({
    where: {
      status: "unknown",
      route: { startsWith: "sms.send:" },
      updatedAt: { lt: cutoff },
      result: { path: ["failure", "kind"], equals: "confirmation_failed" },
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let confirmed = 0;
  for (const candidate of candidates) {
    const changed = await db.$transaction(async (tx) => {
      // Shared with HTTP and webhook confirmation; reread after acquiring it.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${candidate.id}))`;
      const operation = await tx.operation.findUnique({
        where: { id: candidate.id },
      });
      if (
        !operation ||
        operation.status !== "unknown" ||
        operation.updatedAt >= cutoff
      )
        return false;
      // Back off conflicts or malformed saved evidence so they cannot starve later rows.
      await tx.operation.update({
        where: { id: operation.id },
        data: { updatedAt: new Date() },
      });
      const result = acceptedResult.safeParse(operation.result);
      if (!result.success) return false;
      return confirmSmsSend(tx, operation.id, result.data.providerMessageId);
    });
    if (changed) confirmed++;
  }
  return { confirmed };
}
