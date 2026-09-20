import { listInput } from "@agentinfra/contracts";
import type { Database, Prisma } from "@agentinfra/db";
import { authorize, type Principal } from "./principal";
import { assert } from "./errors";

/** Called under the organization's transaction lock, before quota reservation. */
export async function requestActionApproval(
  tx: Prisma.TransactionClient,
  p: Principal,
  input: {
    route: string;
    key: string;
    requestHash: string;
    resourceId: string;
    parameters: Prisma.InputJsonObject;
    policyVersion: number;
    renewExpired?: boolean;
  },
) {
  const unique = {
    organizationId: p.organizationId,
    principalId: p.id,
    route: input.route,
    key: input.key,
    policyVersion: input.policyVersion,
  };
  const earlier = await tx.approval.findFirst({
    where: {
      organizationId: p.organizationId,
      principalId: p.id,
      route: input.route,
      key: input.key,
    },
    select: { requestHash: true },
  });
  assert(
    !earlier || earlier.requestHash === input.requestHash,
    409,
    "idempotency_conflict",
    "Approval key was used for different parameters",
  );
  let row = await tx.approval.findUnique({
    where: { organizationId_principalId_route_key_policyVersion: unique },
  });
  if (!row) {
    row = await tx.approval.create({
      data: {
        ...unique,
        requestHash: input.requestHash,
        parameters: input.parameters,
        resourceId: input.resourceId,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: p.organizationId,
        actorId: p.id,
        action: "approval.requested",
        resourceId: row.id,
      },
    });
  }
  // Keyless inbox requests cannot pick a new retry key after expiry. Require a
  // fresh human decision on the same request, without reviving denied actions.
  if (input.renewExpired)
    assert(
      row.status !== "denied",
      403,
      "approval_denied",
      "The requested action was denied",
    );
  if (
    input.renewExpired &&
    row.expiresAt <= new Date() &&
    ["pending", "approved"].includes(row.status)
  ) {
    row = await tx.approval.update({
      where: { id: row.id },
      data: {
        status: "pending",
        expiresAt: new Date(Date.now() + 86400000),
        decidedAt: null,
        decidedBy: null,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: p.organizationId,
        actorId: p.id,
        action: "approval.renewed",
        resourceId: row.id,
      },
    });
  }
  assert(
    row.requestHash === input.requestHash &&
      row.resourceId === input.resourceId,
    409,
    "idempotency_conflict",
    "Approval key was used for different parameters",
  );
  assert(
    row.expiresAt > new Date(),
    409,
    "approval_expired",
    "Approval expired; submit a new request with a new idempotency key",
  );
  assert(
    row.status !== "denied",
    403,
    "approval_denied",
    "The requested action was denied",
  );
  assert(
    row.status !== "consumed",
    409,
    "approval_consumed",
    "Approval has already been used",
  );
  return row;
}
function human(p: Principal) {
  assert(
    p.credential?.kind === "session" &&
      ["owner", "admin"].includes(p.role) &&
      !p.impersonatedBy,
    403,
    "forbidden",
    "Only owners or admins using their own dashboard session can decide approvals",
  );
}
export async function decideApproval(
  db: Database,
  p: Principal,
  id: string,
  decision: "approved" | "denied",
) {
  human(p);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${p.organizationId}))`;
    const row = await tx.approval.findFirst({
      where: { id, organizationId: p.organizationId },
    });
    assert(row, 404, "not_found", "Approval not found");
    assert(
      row.expiresAt > new Date(),
      409,
      "approval_expired",
      "Approval expired",
    );
    const policy = await tx.organization.findUniqueOrThrow({
      where: { id: p.organizationId },
    });
    assert(
      row.policyVersion === policy.policyVersion,
      409,
      "policy_changed",
      "Policy changed; request a new approval",
    );
    if (row.status === decision) return { id, status: decision };
    assert(
      row.status === "pending",
      409,
      "approval_decided",
      "Approval has already been decided",
    );
    await tx.approval.update({
      where: { id },
      data: { status: decision, decidedBy: p.userId, decidedAt: new Date() },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: p.organizationId,
        actorId: p.userId,
        action: `approval.${decision}`,
        resourceId: id,
      },
    });
    return { id, status: decision };
  });
}
export async function listApprovals(
  db: Database,
  p: Principal,
  query: unknown = {},
) {
  const { cursor, limit } = listInput.parse(query);
  const adminSession =
    p.credential?.kind === "session" &&
    ["owner", "admin"].includes(p.role) &&
    !p.impersonatedBy;
  assert(
    !p.impersonatedBy,
    403,
    "forbidden",
    "Approvals are unavailable while impersonating",
  );
  if (
    !adminSession &&
    !["sms:send", "inboxes:write", "numbers:provision"].some((scope) =>
      p.scopes.includes(scope),
    )
  )
    authorize(p, "email:send");
  const policy = await db.organization.findUniqueOrThrow({
    where: { id: p.organizationId },
    select: { policyVersion: true },
  });
  const scope = {
    organizationId: p.organizationId,
    ...(!adminSession ? { principalId: p.id } : {}),
  };
  const after = cursor
    ? await db.approval.findFirst({
        where: { ...scope, id: cursor },
        select: { id: true, createdAt: true },
      })
    : null;
  assert(!cursor || after, 400, "invalid_cursor", "Invalid approval cursor");
  const rows = await db.approval.findMany({
    where: {
      ...scope,
      ...(after
        ? {
            OR: [
              { createdAt: { lt: after.createdAt } },
              { createdAt: after.createdAt, id: { lt: after.id } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      principalId: true,
      route: true,
      resourceId: true,
      parameters: true,
      status: true,
      expiresAt: true,
      policyVersion: true,
      decidedAt: true,
      operationId: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const data = rows.slice(0, limit).map((row) =>
    row.route === "number.provision"
      ? {
          ...row,
          parameters: {
            ...(row.parameters as Record<string, unknown>),
            monthlyCost: "3.00",
            upfrontCost: "0.00",
            currency: "USD",
          },
        }
      : row,
  );
  return {
    policyVersion: policy.policyVersion,
    data,
    nextCursor: rows.length > limit ? data.at(-1)!.id : null,
  };
}
