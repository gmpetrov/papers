import { resourceAccess } from "./resource-grants";
import { reserveCredentialUsage } from "./key-usage";
import { requestActionApproval } from "./approvals";
import type { Database } from "@agentinfra/db";
import { numberInput } from "@agentinfra/contracts";
import { TelnyxProvider, ProviderHttpError } from "@agentinfra/providers";
import type { Environment } from "./index";
import { authorize, ownedAgent, type Principal } from "./principal";
import { AppError, assert, hash } from "./errors";

const provider = (env: Environment) =>
  new TelnyxProvider(env.TELNYX_API_KEY, env.TELNYX_STATUS);
const rejected = (e: unknown) =>
  e instanceof ProviderHttpError &&
  e.status >= 400 &&
  e.status < 500 &&
  ![408, 409, 429].includes(e.status);
function ready(env: Environment) {
  assert(
    env.TELNYX_STATUS === "active" && env.TELNYX_API_KEY,
    503,
    "verification_required",
    "Telnyx is not active",
  );
  assert(
    env.TELNYX_MESSAGING_PROFILE_ID && env.TELNYX_PUBLIC_KEY,
    503,
    "not_configured",
    "Phone messaging configuration is incomplete",
  );
}
function idempotencyKey(key?: string): asserts key is string {
  assert(
    key && key.length <= 200,
    400,
    "idempotency_key_required",
    "Provide an Idempotency-Key",
  );
}
// Both prices have already passed the unsigned decimal-string schema.
// Normalize insignificant zeroes without rounding through JavaScript numbers.
function canonicalPrice(value: string) {
  const [whole, fraction = ""] = value.split(".");
  const integer = whole!.replace(/^0+/, "") || "0";
  const decimal = fraction.replace(/0+$/, "");
  return decimal ? `${integer}.${decimal}` : integer;
}
export async function provisionNumber(
  db: Database,
  env: Environment,
  p: Principal,
  body: unknown,
  key?: string,
) {
  authorize(p, "numbers:provision");
  assert(
    p.role !== "member" && !p.impersonatedBy,
    403,
    "forbidden",
    "An authorized workspace administrator or credential is required",
  );
  idempotencyKey(key);
  const input = numberInput.parse(body);
  const agentId = input.agentId ?? p.agentId;
  if (agentId) ownedAgent(p, agentId);
  const requestHash = await hash(JSON.stringify(input));
  const op = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${p.organizationId}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.phoneNumber}))`;
    const prior = await tx.operation.findUnique({
      where: {
        organizationId_principalId_route_key: {
          organizationId: p.organizationId,
          principalId: p.id,
          route: "number.provision",
          key,
        },
      },
    });
    if (prior) {
      assert(
        prior.requestHash === requestHash,
        409,
        "idempotency_conflict",
        "Key was used for different parameters",
      );
      return { ...prior, replay: true };
    }
    ready(env);
    if (agentId)
      assert(
        await tx.agent.findFirst({
          where: { id: agentId, organizationId: p.organizationId },
        }),
        404,
        "not_found",
        "Agent not found",
      );
    const organization = await tx.organization.findUniqueOrThrow({
      where: { id: p.organizationId },
    });
    assert(
      (await tx.phoneNumber.count({
        where: {
          organizationId: p.organizationId,
          status: { notIn: ["released", "failed"] },
        },
      })) < organization.maxPhoneNumbers,
      409,
      "quota_exceeded",
      "Workspace phone number limit reached",
    );
    const existing = await tx.phoneNumber.findUnique({
      where: { phoneNumber: input.phoneNumber },
    });
    assert(
      !existing ||
        (existing.organizationId === p.organizationId &&
          existing.status === "failed" &&
          !existing.providerId),
      409,
      "number_unavailable",
      "This number already has an assignment or purchase record",
    );
    let approvalId: string | undefined;
    if (
      organization.requireProvisioningApproval &&
      p.credential?.kind !== "session"
    ) {
      const approval = await requestActionApproval(tx, p, {
        route: "number.provision",
        key,
        requestHash,
        resourceId: input.phoneNumber,
        parameters: { ...input, ...(agentId ? { agentId } : {}) },
        policyVersion: organization.policyVersion,
      });
      if (approval.status !== "approved")
        return { approvalRequired: approval.id } as const;
      approvalId = approval.id;
    }
    await reserveCredentialUsage(
      tx,
      p,
      "number",
      new Date().toISOString().slice(0, 10),
    );
    const operationId = crypto.randomUUID();
    const data = {
      status: "pending",
      providerOrderId: null,
      lastError: null,
      organizationId: p.organizationId,
      agentId: agentId ?? null,
      phoneNumber: input.phoneNumber,
      messagingProfileId: env.TELNYX_MESSAGING_PROFILE_ID!,
      orderReference: operationId,
      monthlyCost: input.monthlyCost,
      upfrontCost: input.upfrontCost,
      currency: input.currency,
      nextReconcileAt: new Date(Date.now() + 60000),
    };
    const number = existing
      ? await tx.phoneNumber.update({ where: { id: existing.id }, data })
      : await tx.phoneNumber.create({ data });
    const operation = await tx.operation.create({
      data: {
        id: operationId,
        organizationId: p.organizationId,
        principalId: p.id,
        route: "number.provision",
        key,
        requestHash,
        resourceId: number.id,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: p.organizationId,
        actorId: p.userId,
        action: "number.purchase_requested",
        resourceId: number.id,
      },
    });
    if (approvalId)
      await tx.approval.update({
        where: { id: approvalId },
        data: { status: "consumed", operationId: operation.id },
      });
    return { ...operation, replay: false };
  });
  if ("approvalRequired" in op)
    throw new AppError(
      409,
      "approval_required",
      "Ask a workspace owner or admin to review this phone purchase, then retry with the same idempotency key",
      false,
      { approvalId: op.approvalRequired! },
    );
  if (!op.replay) {
    let submitted = false;
    try {
      // Recheck current inventory and the exact displayed prices before purchasing.
      const result = await provider(env).search(
        input.country,
        input.phoneNumber,
      );
      const quote = result.data.find(
        (n) =>
          n.phone_number === input.phoneNumber &&
          n.features.some((f) => f.name === "sms"),
      );
      assert(
        quote,
        409,
        "number_unavailable",
        "This number is no longer available",
      );
      assert(
        canonicalPrice(quote.cost_information.monthly_cost) ===
          canonicalPrice(input.monthlyCost) &&
          canonicalPrice(quote.cost_information.upfront_cost) ===
            canonicalPrice(input.upfrontCost) &&
          quote.cost_information.currency === input.currency,
        409,
        "price_changed",
        "Number pricing changed. Search again to review the current price",
      );
      submitted = true;
      const order = await provider(env).provision(
        input.phoneNumber,
        env.TELNYX_MESSAGING_PROFILE_ID!,
        op.id,
      );
      await db.phoneNumber.update({
        where: { id: op.resourceId! },
        data: { providerOrderId: order.id, nextReconcileAt: new Date() },
      });
    } catch (e) {
      const failed = !submitted || rejected(e);
      const code =
        e instanceof AppError
          ? e.code
          : failed
            ? "provider_rejected"
            : "provider_outcome_unknown";
      await db.$transaction([
        db.operation.update({
          where: { id: op.id },
          data: { status: failed ? "failed" : "unknown", error: code },
        }),
        db.phoneNumber.update({
          where: { id: op.resourceId! },
          data: { status: failed ? "failed" : "unknown", lastError: code },
        }),
      ]);
    }
  }
  return operationResponse(db, op.id);
}
async function operationResponse(db: Database, id: string) {
  const operation = await db.operation.findUniqueOrThrow({ where: { id } });
  return {
    status: (operation.status === "pending" || operation.status === "unknown"
      ? 202
      : 200) as 200 | 202,
    body: {
      id,
      status: operation.status,
      numberId: operation.resourceId,
      error: operation.error,
      statusUrl: `/v1/operations/${id}`,
    },
  };
}
export async function releaseNumber(
  db: Database,
  env: Environment,
  p: Principal,
  id: string,
  key?: string,
) {
  authorize(p, "numbers:release");
  assert(
    p.role !== "member" && !p.impersonatedBy,
    403,
    "forbidden",
    "An authorized workspace administrator or credential is required",
  );
  idempotencyKey(key);
  const operation = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${p.organizationId}))`;
    const number = await tx.phoneNumber.findFirst({
      where: {
        id,
        ...resourceAccess(p, "number"),
      },
    });
    assert(number, 404, "not_found", "Phone number not found");
    const prior = await tx.operation.findUnique({
      where: {
        organizationId_principalId_route_key: {
          organizationId: p.organizationId,
          principalId: p.id,
          route: `number.release:${id}`,
          key,
        },
      },
    });
    if (prior) return { ...prior, replay: true, number };
    ready(env);
    assert(
      number.status === "active" && number.providerId,
      409,
      "number_inactive",
      "Only an active phone number can be released",
    );
    await tx.phoneNumber.update({
      where: { id },
      data: {
        status: "releasing",
        lastError: null,
        nextReconcileAt: new Date(Date.now() + 60000),
      },
    });
    const op = await tx.operation.create({
      data: {
        organizationId: p.organizationId,
        principalId: p.id,
        route: `number.release:${id}`,
        key,
        requestHash: await hash(id),
        resourceId: id,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: p.organizationId,
        actorId: p.userId,
        action: "number.release_requested",
        resourceId: id,
      },
    });
    return { ...op, replay: false, number };
  });
  if (!operation.replay) {
    try {
      await provider(env).release(operation.number.providerId!);
      await finishRelease(db, id, operation.id);
    } catch (e) {
      if (e instanceof ProviderHttpError && e.status === 404)
        await finishRelease(db, id, operation.id);
      else {
        const failed = rejected(e);
        await db.$transaction([
          db.operation.update({
            where: { id: operation.id },
            data: {
              status: failed ? "failed" : "unknown",
              error: failed ? "provider_rejected" : "provider_outcome_unknown",
            },
          }),
          db.phoneNumber.update({
            where: { id },
            data: {
              status: failed ? "active" : "releasing",
              lastError: failed
                ? "provider_rejected"
                : "provider_outcome_unknown",
            },
          }),
        ]);
      }
    }
  }
  return operationResponse(db, operation.id);
}
async function finishRelease(db: Database, id: string, operationId: string) {
  await db.$transaction(async (tx) => {
    const result = await tx.phoneNumber.updateMany({
      where: { id, status: "releasing" },
      data: { status: "released", lastError: null },
    });
    await tx.operation.update({
      where: { id: operationId },
      data: { status: "completed", error: null },
    });
    if (result.count) {
      const n = await tx.phoneNumber.findUniqueOrThrow({ where: { id } });
      await tx.event.create({
        data: {
          organizationId: n.organizationId,
          agentId: n.agentId,
          resourceId: id,
          type: "number.released",
        },
      });
    }
  });
}
/** Reads provider state to recover delayed/lost responses. Never repeats a purchase or delete. */
export async function reconcilePhoneNumbers(
  db: Database,
  env: Environment,
  limit = 10,
) {
  if (env.TELNYX_STATUS !== "active" || !env.TELNYX_API_KEY)
    return { processed: 0 };
  const rows = await db.phoneNumber.findMany({
    where: {
      status: {
        in: ["pending", "unknown", "awaiting_requirements", "releasing"],
      },
      nextReconcileAt: { lte: new Date() },
    },
    orderBy: { nextReconcileAt: "asc" },
    take: limit,
  });
  let processed = 0;
  for (const row of rows) {
    const claim = await db.phoneNumber.updateMany({
      where: {
        id: row.id,
        status: row.status,
        nextReconcileAt: row.nextReconcileAt,
      },
      data: { nextReconcileAt: new Date(Date.now() + 120000) },
    });
    if (!claim.count) continue;
    try {
      const api = provider(env);
      if (row.status === "releasing") {
        const op = await db.operation.findFirst({
          where: {
            resourceId: row.id,
            route: `number.release:${row.id}`,
            status: { in: ["pending", "unknown"] },
          },
          orderBy: { createdAt: "desc" },
        });
        if (op && row.providerId) {
          try {
            await api.number(row.providerId);
          } catch (e) {
            if (e instanceof ProviderHttpError && e.status === 404)
              await finishRelease(db, row.id, op.id);
            else throw e;
          }
        }
      } else if (row.orderReference) {
        let order = row.providerOrderId
          ? await api.order(row.providerOrderId)
          : await api.findOrder(row.orderReference);
        if (!order) continue; // A missing order is not proof a timed-out purchase failed.
        if (!row.providerOrderId) {
          await db.phoneNumber.update({
            where: { id: row.id, orderReference: row.orderReference },
            data: { providerOrderId: order.id },
          });
          order = await api.order(order.id);
        }
        const ordered = order.phone_numbers.find(
          (n) => n.phone_number === row.phoneNumber,
        );
        assert(
          ordered,
          502,
          "provider_mismatch",
          "Order does not contain the expected number",
        );
        if (
          ["failure", "failed", "cancelled"].includes(
            ordered.status ?? order.status,
          )
        ) {
          await db.$transaction([
            db.phoneNumber.update({
              where: { id: row.id, orderReference: row.orderReference },
              data: { status: "failed", lastError: "order_failed" },
            }),
            db.operation.update({
              where: { id: row.orderReference },
              data: { status: "failed", error: "order_failed" },
            }),
          ]);
        } else if (
          ordered.requirements_met === false ||
          order.requirements_met === false
        ) {
          await db.phoneNumber.update({
            where: { id: row.id, orderReference: row.orderReference },
            data: {
              status: "awaiting_requirements",
              lastError: "provider_requirements_pending",
            },
          });
        } else if (ordered.status === "success" || order.status === "success") {
          const owned = await api.findNumber(row.phoneNumber);
          if (!owned || (owned.status && owned.status !== "active")) continue;
          let config = await api.messagingNumber(row.phoneNumber);
          if (config.messaging_profile_id !== row.messagingProfileId) {
            await api.assignMessaging(row.phoneNumber, row.messagingProfileId);
            config = await api.messagingNumber(row.phoneNumber);
          }
          assert(
            config.phone_number === row.phoneNumber &&
              config.messaging_profile_id === row.messagingProfileId,
            502,
            "provider_mismatch",
            "Messaging assignment is incomplete",
          );
          await db.$transaction(async (tx) => {
            const result = await tx.phoneNumber.updateMany({
              where: {
                id: row.id,
                orderReference: row.orderReference,
                status: { in: ["pending", "unknown", "awaiting_requirements"] },
              },
              data: { providerId: owned.id, status: "active", lastError: null },
            });
            if (result.count) {
              await tx.operation.update({
                where: { id: row.orderReference! },
                data: { status: "completed", error: null },
              });
              await tx.event.create({
                data: {
                  organizationId: row.organizationId,
                  agentId: row.agentId,
                  type: "number.activated",
                  resourceId: row.id,
                },
              });
            }
          });
        }
      }
      processed++;
    } catch {
      await db.phoneNumber.updateMany({
        where: { id: row.id, orderReference: row.orderReference },
        data: { lastError: "provider_check_failed" },
      });
    }
  }
  return { processed };
}
