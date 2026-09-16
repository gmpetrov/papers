import { Prisma, type Database } from "@agentinfra/db";
import type { Principal } from "./principal";
import { assert } from "./errors";

export function resourceAccess(p: Principal, kind: "inbox" | "number") {
  return {
    organizationId: p.organizationId,
    ...(p.agentId ? { agentId: p.agentId } : {}),
    ...(p.resourceGrants
      ? {
          AND: {
            id: {
              in:
                kind === "inbox"
                  ? p.resourceGrants.inboxIds
                  : p.resourceGrants.phoneNumberIds,
            },
          },
        }
      : {}),
  };
}
export async function validateResourceGrants(
  db: Database,
  p: Principal,
  grants: NonNullable<Principal["resourceGrants"]>,
  agentId?: string,
) {
  const inboxIds = [...new Set(grants.inboxIds)];
  const phoneNumberIds = [...new Set(grants.phoneNumberIds)];
  const where = {
    organizationId: p.organizationId,
    ...(agentId ? { agentId } : {}),
  };
  const [inboxes, numbers] = await Promise.all([
    db.inbox.count({ where: { ...where, id: { in: inboxIds } } }),
    db.phoneNumber.count({ where: { ...where, id: { in: phoneNumberIds } } }),
  ]);
  assert(
    inboxes === inboxIds.length && numbers === phoneNumberIds.length,
    404,
    "not_found",
    "One or more selected resources are unavailable",
  );
  return { inboxIds, phoneNumberIds };
}

export async function listGrantedEvents(
  db: Database,
  p: Principal,
  q: { limit: number; cursor?: string },
) {
  const grants = p.resourceGrants!;
  const inboxMatch = grants.inboxIds.length
    ? Prisma.sql`i.id IN (${Prisma.join(grants.inboxIds)})`
    : Prisma.sql`false`;
  const numberMatch = grants.phoneNumberIds.length
    ? Prisma.sql`n.id IN (${Prisma.join(grants.phoneNumberIds)})`
    : Prisma.sql`false`;
  return db.$queryRaw<
    {
      id: string;
      organizationId: string;
      agentId: string | null;
      type: string;
      resourceId: string;
      createdAt: Date;
    }[]
  >(Prisma.sql`
    SELECT e.* FROM "Event" e WHERE e."organizationId" = ${p.organizationId}
    ${p.agentId ? Prisma.sql`AND e."agentId" = ${p.agentId}` : Prisma.empty}
    ${q.cursor ? Prisma.sql`AND e.id > ${q.cursor}` : Prisma.empty}
    AND (
      EXISTS (SELECT 1 FROM "Inbox" i WHERE i."organizationId" = e."organizationId" AND ${inboxMatch}
        AND (i.id = e."resourceId" OR EXISTS (SELECT 1 FROM "EmailMessage" m WHERE m."inboxId" = i.id AND m.id = e."resourceId")))
      OR EXISTS (SELECT 1 FROM "PhoneNumber" n WHERE n."organizationId" = e."organizationId" AND ${numberMatch}
        AND (n.id = e."resourceId" OR EXISTS (SELECT 1 FROM "SmsMessage" m WHERE m."phoneNumberId" = n.id AND m.id = e."resourceId")))
    ) ORDER BY e.id ASC LIMIT ${q.limit + 1}
  `);
}
