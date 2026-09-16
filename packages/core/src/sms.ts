import { resourceAccess } from "./resource-grants";
import { reserveCredentialSend } from "./key-usage";
import { assertSmsRecipientAllowed } from "./sms-opt-out";
import { requestActionApproval } from "./approvals";
import { confirmSmsSend } from "./sms-delivery";
import type { Database } from "@agentinfra/db";
import { smsFailure } from "./provider-failure";
import { smsInput, smsFailureSchema } from "@agentinfra/contracts";
import { TelnyxProvider, ProviderHttpError } from "@agentinfra/providers";
import type { Environment } from "./index";
import { authorize, type Principal } from "./principal";
import { AppError, assert, hash } from "./errors";
export async function sendSms(
  db: Database,
  env: Environment,
  p: Principal,
  numberId: string,
  body: unknown,
  key: string | undefined,
) {
  authorize(p, "sms:send");
  assert(
    p.role !== "member",
    403,
    "forbidden",
    "Admin or delegated agent required",
  );
  const input = smsInput.parse(body);
  assert(
    key && key.length <= 200,
    400,
    "idempotency_key_required",
    "Provide an Idempotency-Key",
  );
  const number = await db.phoneNumber.findFirst({
    where: {
      id: numberId,
      ...resourceAccess(p, "number"),
    },
    include: { agent: true },
  });
  assert(number, 404, "not_found", "Phone number not found");
  const requestHash = await hash(JSON.stringify(input));
  const route = `sms.send:${number.id}`;
  const operation = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${p.organizationId}))`;
    const prior = await tx.operation.findUnique({
      where: {
        organizationId_principalId_route_key: {
          organizationId: p.organizationId,
          principalId: p.id,
          route,
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
    const currentNumber = await tx.phoneNumber.findFirst({
      where: {
        id: number.id,
        ...resourceAccess(p, "number"),
      },
      include: { agent: true },
    });
    assert(currentNumber, 404, "not_found", "Phone number not found");
    assert(
      env.TELNYX_STATUS === "active" && env.TELNYX_API_KEY,
      503,
      "verification_required",
      "SMS sending is unavailable while Telnyx activation is pending",
    );
    assert(
      currentNumber.status === "active",
      409,
      "number_inactive",
      "Phone number is not active",
    );
    assert(
      !currentNumber.agent?.allowedSmsRecipients.length ||
        currentNumber.agent.allowedSmsRecipients.includes(input.to),
      403,
      "recipient_not_allowed",
      "Recipient not allowed by agent policy",
    );
    await assertSmsRecipientAllowed(
      tx,
      currentNumber.messagingProfileId,
      input.to,
    );
    const approvalPolicy = await tx.organization.findUniqueOrThrow({
      where: { id: p.organizationId },
    });
    let approvalId: string | undefined;
    if (approvalPolicy.requireSmsApproval && p.credential?.kind !== "session") {
      const approval = await requestActionApproval(tx, p, {
        route,
        key,
        requestHash,
        resourceId: number.id,
        parameters: input,
        policyVersion: approvalPolicy.policyVersion,
      });
      if (approval.status !== "approved")
        return { approvalRequired: approval.id } as const;
      approvalId = approval.id;
    }
    const day = new Date().toISOString().slice(0, 10);
    await reserveCredentialSend(tx, p, "sms", day);
    if (currentNumber.agentId && currentNumber.agent) {
      const usage = await tx.dailyUsage.upsert({
        where: { agentId_day: { agentId: currentNumber.agentId, day } },
        create: { agentId: currentNumber.agentId, day },
        update: {},
      });
      assert(
        usage.smsSends < currentNumber.agent.dailySmsLimit,
        429,
        "quota_exceeded",
        "Daily SMS limit reached",
      );
      await tx.dailyUsage.update({
        where: { id: usage.id },
        data: { smsSends: { increment: 1 } },
      });
    }
    {
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: p.organizationId },
      });
      const usage = await tx.workspaceEmailUsage.upsert({
        where: {
          organizationId_day: { organizationId: p.organizationId, day },
        },
        create: { organizationId: p.organizationId, day },
        update: {},
      });
      assert(
        usage.smsSends < organization.dailySmsLimit,
        429,
        "quota_exceeded",
        "Workspace daily SMS limit reached",
      );
      await tx.workspaceEmailUsage.update({
        where: { id: usage.id },
        data: { smsSends: { increment: 1 } },
      });
    }
    const message = await tx.smsMessage.create({
      data: {
        organizationId: p.organizationId,
        phoneNumberId: number.id,
        direction: "outbound",
        status: "pending",
        from: number.phoneNumber,
        ...input,
        unread: false,
      },
    });
    const operationId = crypto.randomUUID();
    const callback = env.TELNYX_WEBHOOK_URL
      ? new URL(env.TELNYX_WEBHOOK_URL)
      : null;
    if (callback) callback.searchParams.set("papers_operation", operationId);
    const op = await tx.operation.create({
      data: {
        id: operationId,
        result: callback ? { webhookUrl: callback.href } : undefined,
        organizationId: p.organizationId,
        principalId: p.id,
        route,
        key,
        requestHash,
        resourceId: message.id,
      },
    });
    if (approvalId)
      await tx.approval.update({
        where: { id: approvalId },
        data: { status: "consumed", operationId: op.id },
      });
    await tx.auditEvent.create({
      data: {
        organizationId: p.organizationId,
        actorId: p.id,
        impersonatedBy: p.impersonatedBy,
        action: "sms.send_requested",
        resourceId: message.id,
      },
    });
    return { ...op, replay: false };
  });
  if ("approvalRequired" in operation)
    throw new AppError(
      409,
      "approval_required",
      "A workspace owner or admin must approve this SMS before you retry the same request",
      false,
      { approvalId: operation.approvalRequired! },
    );
  const response = async (http: 200 | 201 | 202) => {
    const saved = await db.operation.findUniqueOrThrow({
      where: { id: operation.id },
    });
    const failure = smsFailureSchema.safeParse(
      (saved.result as { failure?: unknown } | null)?.failure,
    );
    return {
      status:
        saved.status === "completed" && http === 202 ? (200 as const) : http,
      body: {
        id: operation.id,
        status: saved.status,
        error: saved.error,
        ...(saved.status !== "completed" && failure.success
          ? { failure: failure.data }
          : {}),
        messageId: operation.resourceId,
        statusUrl: `/v1/operations/${operation.id}`,
      },
    };
  };
  if (operation.replay)
    return response(
      operation.status === "pending" || operation.status === "unknown"
        ? 202
        : 200,
    );
  let acceptedProviderId: string | undefined;
  try {
    // Do not retry an ambiguous provider request; Telnyx message idempotency is not assumed.
    const result = await new TelnyxProvider(
      env.TELNYX_API_KEY,
      env.TELNYX_STATUS,
    ).send(
      number.phoneNumber,
      input.to,
      input.text,
      number.messagingProfileId,
      (operation.result as { webhookUrl?: string } | null)?.webhookUrl,
    );

    acceptedProviderId = result.data.id;
    const confirmed = await db.$transaction((tx) =>
      confirmSmsSend(tx, operation.id, result.data.id),
    );
    assert(
      confirmed,
      502,
      "provider_mismatch",
      "Provider response conflicts with the saved message",
    );
    return response(201);
  } catch (error) {
    const rejected =
      !acceptedProviderId &&
      error instanceof ProviderHttpError &&
      error.status >= 400 &&
      error.status < 500 &&
      (![408, 409, 429].includes(error.status) ||
        // Telnyx uses 409 for a missing international alpha sender. This
        // explicitly rejects the send; other conflicts remain ambiguous.
        (error.status === 409 &&
          error.codes.length > 0 &&
          error.codes.every((code) => code === "40306")));
    const current = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${operation.id}))`;
      const current = await tx.operation.findUniqueOrThrow({
        where: { id: operation.id },
      });
      if (current.status === "completed") return current.status;
      await tx.operation.update({
        where: { id: operation.id },
        data: {
          result: {
            ...((current.result as Record<string, string> | null) ?? {}),
            ...(acceptedProviderId
              ? { providerMessageId: acceptedProviderId }
              : {}),
            failure: smsFailure(error, !!acceptedProviderId),
          },
          status: rejected ? "failed" : "unknown",
          error: rejected ? "provider_rejected" : "provider_outcome_unknown",
        },
      });
      if (rejected)
        await tx.smsMessage.updateMany({
          where: {
            id: operation.resourceId!,
            providerId: null,
            status: "pending",
          },
          data: { status: "failed" },
        });
      return rejected ? "failed" : "unknown";
    });
    return response(current === "unknown" ? 202 : 200);
  }
}
