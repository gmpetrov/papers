import { retailAmount } from "./phone-retail";
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
      db.$queryRaw<
        {
          direction: string;
          messages: bigint;
          messagesWithCost: bigint;
          messagesWithSegments: bigint;
          reportedSegments: bigint | null;
          chargeMicros: string | null;
        }[]
      >`
        SELECT m.direction, COUNT(*) AS messages,
          COUNT(r.id) AS "messagesWithCost", COUNT(m.segments) AS "messagesWithSegments",
          SUM(m.segments) AS "reportedSegments", SUM(r."settledMicros")::text AS "chargeMicros"
        FROM "SmsMessage" m LEFT JOIN "BillingReservation" r ON r.id=m.id AND r.status='settled'
        WHERE m."organizationId"=${p.organizationId} AND m."createdAt">=${start} AND m."createdAt"<${end}
        GROUP BY m.direction ORDER BY m.direction`,
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
      currency: "USD",
      messages: Number(row.messages),
      messagesWithCost: Number(row.messagesWithCost),
      messagesWithSegments: Number(row.messagesWithSegments),
      reportedSegments:
        row.reportedSegments === null ? null : Number(row.reportedSegments),
      chargedAmount:
        row.chargeMicros === null
          ? null
          : retailAmount(BigInt(row.chargeMicros)),
    })),
    basis: "message_created_at",
    costSource: "papers_ledger",
    billingStatus: "prepaid",
  };
}
