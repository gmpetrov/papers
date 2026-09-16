import type { Database } from "@agentinfra/db";
import type { Principal } from "./principal";
import { z } from "zod";
import { assert } from "./errors";
const querySchema = z.object({
  month: z
    .string()
    .regex(/^20\d{2}-(0[1-9]|1[0-2])$/)
    .optional(),
});

export async function getWorkspaceUsage(
  db: Database,
  p: Principal,
  query: unknown,
) {
  assert(
    p.credential?.kind === "session" &&
      ["owner", "admin"].includes(p.role) &&
      !p.impersonatedBy,
    403,
    "forbidden",
    "Use an owner or admin session outside impersonation to view workspace usage",
  );
  const { month = new Date().toISOString().slice(0, 7) } =
    querySchema.parse(query);
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(year!, monthNumber!, 1));
  const where = {
    organizationId: p.organizationId,
    createdAt: { gte: start, lt: end },
  };
  const [email, sms] = await db.$transaction(
    [
      db.emailMessage.groupBy({
        by: ["direction"],
        where,
        _count: { _all: true },
      }),
      db.smsMessage.groupBy({
        by: ["direction", "costCurrency"],
        where,
        _count: { _all: true, costAmount: true, segments: true },
        _sum: { costAmount: true, segments: true },
      }),
    ],
    { isolationLevel: "RepeatableRead" },
  );
  return {
    month,
    timezone: "UTC",
    start: start.toISOString(),
    endExclusive: end.toISOString(),
    email: email.map((row) => ({
      direction: row.direction,
      messages: row._count._all,
    })),
    sms: sms.map((row) => ({
      direction: row.direction,
      currency: row.costCurrency,
      messages: row._count._all,
      messagesWithCost: row._count.costAmount,
      messagesWithSegments: row._count.segments,
      reportedSegments: row._sum.segments,
      reportedProviderCost: row._sum.costAmount?.toString() ?? null,
    })),
    basis: "message_created_at",
    costSource: "provider_callbacks",
    billingStatus: "not_implemented",
  };
}
