import { bodyLimit } from "hono/body-limit";
import { attachmentSummary, validateOutgoingAttachments, storeOutgoingAttachments } from "./outgoing-attachments";
import {
  retailNumber,
  standardNumber,
  retailAmount,
  selectedNumberQuote,
} from "./phone-retail";
import { ensureBilling, reserveEmail, releaseEmail } from "./billing-ledger";
import {
  billingSummary,
  startCheckout,
  billingPortal,
  changePlan,
  updateAutoTopup,
} from "./stripe-billing";
export { ingestStripe } from "./stripe-billing";
import {
  resourceAccess,
  validateResourceGrants,
  listGrantedEvents,
} from "./resource-grants";
import { consumeApiRequest } from "./request-limits";
import { connectionLimitsInput } from "@agentinfra/contracts";
import { getCredentialLimits } from "./send-limits";
import { reserveCredentialSend, reserveCredentialUsage } from "./key-usage";
import {
  decideApproval,
  listApprovals,
  requestActionApproval,
} from "./approvals";
import { getWorkspaceUsage } from "./usage";
import { provisionNumber, releaseNumber } from "./phone-numbers";
import { assertInboxCapacity } from "./inbox-limits";
import {
  createWebhookEndpoint,
  listWebhookEndpoints,
  listWebhookDeliveries,
  getWebhookDelivery,
  updateWebhookEndpoint,
  deleteWebhookEndpoint,
  rotateWebhookSecret,
} from "./customer-webhooks";
import { attachmentDisposition, type AttachmentBucket } from "./attachments";
import { issueAttachmentLink, verifyAttachmentLink } from "./attachment-links";
export { processAttachments } from "./attachments";
export { reconcilePhoneNumbers } from "./phone-numbers";
export { reconcileSmsSends } from "./sms-reconciliation";
import { sendSms } from "./sms";
import { confirmEmailSend } from "./email-delivery";
import { Hono, type Handler } from "hono";
import { z, ZodError } from "zod";
import type { Database } from "@agentinfra/db";
import { Prisma } from "@agentinfra/db";
import type { Auth } from "@agentinfra/auth";
import {
  agentInput,
  inboxInput,
  sendEmailInput,
  keyInput,
  listInput,
  policyInput,
  replyEmailInput,
  messageUpdateInput,
  smsFailureSchema,
  workspacePolicyInput,
} from "@agentinfra/contracts";
import {
  resendClient,
  TelnyxProvider,
  ProviderUnavailable,
  ProviderHttpError,
} from "@agentinfra/providers";
import { AppError, assert, hash } from "./errors";
import {
  authenticate,
  authenticateReference,
  authorize,
  ownedAgent,
  type Principal,
} from "./principal";
export { ingestTelnyx, processTelnyxEvents } from "./telnyx-webhooks";
export { AppError } from "./errors";
export { ingestResend, processProviderEvents } from "./webhooks";
export interface Environment {
  BILLING_ENABLED?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PORTAL_CONFIGURATION_ID?: string;
  BILLING_PUBLIC_ORIGIN?: string;
  CUSTOM_WEBHOOK_ENCRYPTION_KEY?: string;
  ATTACHMENTS?: AttachmentBucket;
  EMAIL_DOMAIN?: string;
  RESEND_API_KEY?: string;
  RESEND_WEBHOOK_SECRET?: string;
  TELNYX_STATUS?: string;
  TELNYX_API_KEY?: string;
  TELNYX_PUBLIC_KEY?: string;
  TELNYX_MESSAGING_PROFILE_ID?: string;
  TELNYX_WEBHOOK_URL?: string;
}
export function createApi(
  db: Database,
  auth: Auth,
  env: Environment,
  resourcePath: "/v1" | "/mcp" = "/v1",
) {
  const app = new Hono<{
    Variables: { principal: Principal; requestId: string };
  }>();
  app.use("*", async (c, next) => {
    c.set("requestId", crypto.randomUUID());
    c.header("X-Request-Id", c.get("requestId"));
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof ZodError)
      return c.json(
        {
          error: {
            code: "validation_error",
            message: "Check the request fields",
            details: error.issues.map(({ code, path, message }) => ({
              code,
              path,
              message,
            })),
            request_id: c.get("requestId"),
            retryable: false,
          },
        },
        400,
      );
    const e =
      error instanceof AppError
        ? error
        : error instanceof ProviderUnavailable
          ? new AppError(503, "verification_required", "Telnyx is not active")
          : error instanceof ProviderHttpError
            ? new AppError(
                502,
                "provider_error",
                "Telnyx could not complete this request",
                true,
              )
            : new AppError(
                500,
                "internal_error",
                "The request could not be completed",
              );
    if (e.status === 401)
      c.header(
        "WWW-Authenticate",
        `Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource" + resourcePath, auth.options.baseURL as string).href}"`,
      );
    if (e.status === 500)
      console.error(
        JSON.stringify({ requestId: c.get("requestId"), error: error.name }),
      );
    return c.json(
      {
        error: {
          code: e.code,
          message: e.message,
          request_id: c.get("requestId"),
          retryable: e.retryable,
          ...(e.details ? { details: e.details } : {}),
        },
      },
      e.status as 400,
    );
  });
  const limitRequest = async (
    c: { header(name: string, value: string): void },
    p: Principal,
  ) => {
    const result = await consumeApiRequest(db, p);
    if (!result.allowed) {
      c.header("Retry-After", String(result.retryAfter));
      throw new AppError(
        429,
        "rate_limited",
        "Too many API requests; retry after the indicated delay",
        true,
      );
    }
  };
  app.get("/health", (c) => c.json({ status: "ok", service: "papers-api" }));
  // This route authenticates the signed capability, then rechecks its original credential.
  app.get("/v1/attachments/:id/content", async (c) => {
    assert(
      auth.options.secret,
      503,
      "not_configured",
      "Attachment links are unavailable",
    );
    const link = await verifyAttachmentLink(
      auth.options.secret,
      c.req.query("token") ?? "",
      auth.options.baseURL as string,
    );
    assert(
      link.attachmentId === c.req.param("id"),
      401,
      "invalid_download_link",
      "Attachment link does not match this file",
    );
    const p = await authenticateReference(
      db,
      auth,
      link.credential,
      link.resourcePath,
    );
    assert(
      p.organizationId === link.organizationId,
      403,
      "forbidden",
      "Attachment access has changed",
    );
    await limitRequest(c, p);
    return downloadAttachment(p, link.attachmentId);
  });
  // Provider-only capability: one stored outbound MMS file, one hour, no user credential.
  app.get("/v1/attachment-media/:id", async (c) => {
    const token = c.req.query("token") ?? "";
    assert(token.length === 72, 404, "not_found", "Media not found");
    const attachment = await db.attachment.findFirst({ where: {
      id: c.req.param("id"), providerTokenHash: await hash(token),
      providerTokenExpiresAt: { gt: new Date() },
      smsMessage: { direction: "outbound", status: { not: "failed" } },
    } });
    assert(attachment?.objectKey, 404, "not_found", "Media not found");
    assert(env.ATTACHMENTS, 503, "storage_unavailable", "Storage is unavailable");
    const object = await env.ATTACHMENTS.get(attachment.objectKey);
    assert(object, 404, "not_found", "Media not found");
    return new Response(object.body, { headers: {
      "Content-Type": attachment.contentType, "Content-Length": String(object.size),
      "Content-Disposition": attachmentDisposition(attachment.filename),
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'", "Referrer-Policy": "no-referrer",
    } });
  });
  app.use("/v1/*", bodyLimit({ maxSize: 8 * 1024 * 1024, onError: () => { throw new AppError(413, "request_too_large", "Request exceeds 8 MiB"); } }));
  app.use("/v1/*", async (c, next) => {
    const p = await authenticate(db, auth, c.req.raw, resourcePath);
    await limitRequest(c, p);
    if (env.BILLING_ENABLED === "true")
      await ensureBilling(db, p.organizationId);
    c.set("principal", p);
    await next();
  });
  app.get("/v1/billing", async (c) =>
    c.json({
      ...(await billingSummary(db, c.get("principal"))),
    }),
  );
  app.post("/v1/billing/checkout", async (c) =>
    c.json(
      await startCheckout(
        db,
        env,
        c.get("principal"),
        await c.req.json(),
        c.req.header("Idempotency-Key"),
      ),
    ),
  );
  app.post("/v1/billing/portal", async (c) =>
    c.json(await billingPortal(db, env, c.get("principal"))),
  );
  app.post("/v1/billing/plan", async (c) =>
    c.json(await changePlan(db, env, c.get("principal"), await c.req.json())),
  );
  app.patch("/v1/billing/auto-topup", async (c) =>
    c.json(await updateAutoTopup(db, c.get("principal"), await c.req.json())),
  );
  const filter = (p: Principal) => ({
    organizationId: p.organizationId,
    ...(p.agentId ? { agentId: p.agentId } : {}),
  });
  const audit = async (p: Principal, action: string, resourceId: string) =>
    db.auditEvent.create({
      data: {
        organizationId: p.organizationId,
        actorId: p.userId,
        impersonatedBy: p.impersonatedBy,
        action,
        resourceId,
      },
    });
  app.get("/v1/me", async (c) => {
    const p = c.get("principal");
    return c.json({
      userId: p.userId,
      organizationId: p.organizationId,
      role: p.role,
      agentId: p.agentId,
      scopes: p.scopes,
      resourceGrants: p.resourceGrants ?? null,
      ...(await getCredentialLimits(db, p)),
      impersonatedBy: p.impersonatedBy,
    });
  });
  app.get("/v1/webhook-endpoints", async (c) =>
    c.json(
      await listWebhookEndpoints(
        db,
        c.get("principal"),
        env.CUSTOM_WEBHOOK_ENCRYPTION_KEY,
      ),
    ),
  );
  app.post("/v1/webhook-endpoints", async (c) =>
    c.json(
      await createWebhookEndpoint(
        db,
        c.get("principal"),
        await c.req.json(),
        env.CUSTOM_WEBHOOK_ENCRYPTION_KEY,
      ),
      201,
    ),
  );
  app.patch("/v1/webhook-endpoints/:id", async (c) =>
    c.json(
      await updateWebhookEndpoint(
        db,
        c.get("principal"),
        c.req.param("id"),
        await c.req.json(),
        env.CUSTOM_WEBHOOK_ENCRYPTION_KEY,
      ),
    ),
  );
  app.delete("/v1/webhook-endpoints/:id", async (c) =>
    c.json(
      await deleteWebhookEndpoint(db, c.get("principal"), c.req.param("id")),
    ),
  );
  app.post("/v1/webhook-endpoints/:id/rotate-secret", async (c) =>
    c.json(
      await rotateWebhookSecret(
        db,
        c.get("principal"),
        c.req.param("id"),
        env.CUSTOM_WEBHOOK_ENCRYPTION_KEY,
      ),
    ),
  );
  app.get("/v1/webhook-endpoints/:id/deliveries", async (c) =>
    c.json(
      await listWebhookDeliveries(
        db,
        c.get("principal"),
        c.req.param("id"),
        c.req.query(),
      ),
    ),
  );
  app.get("/v1/webhook-endpoints/:id/deliveries/:deliveryId", async (c) =>
    c.json(
      await getWebhookDelivery(
        db,
        c.get("principal"),
        c.req.param("id"),
        c.req.param("deliveryId"),
      ),
    ),
  );
  app.get("/v1/approvals", async (c) =>
    c.json(await listApprovals(db, c.get("principal"), c.req.query())),
  );
  app.post("/v1/approvals/:id/approve", async (c) =>
    c.json(
      await decideApproval(
        db,
        c.get("principal"),
        c.req.param("id"),
        "approved",
      ),
    ),
  );
  app.post("/v1/approvals/:id/deny", async (c) =>
    c.json(
      await decideApproval(db, c.get("principal"), c.req.param("id"), "denied"),
    ),
  );
  app.get("/v1/workspace/usage", async (c) =>
    c.json(await getWorkspaceUsage(db, c.get("principal"), c.req.query())),
  );
  app.get("/v1/workspace/policy", async (c) => {
    const p = c.get("principal");
    assert(
      p.id === p.userId,
      403,
      "forbidden",
      "Use your dashboard session to view workspace limits",
    );
    const organization = await db.organization.findUniqueOrThrow({
      where: { id: p.organizationId },
      select: {
        requireSmsApproval: true,
        requireEmailApproval: true,
        requireProvisioningApproval: true,
        dailyEmailLimit: true,
        dailySmsLimit: true,
        maxInboxes: true,
        maxPhoneNumbers: true,
      },
    });
    const day = new Date().toISOString().slice(0, 10);
    const [usage, inboxes, phoneNumbers] = await Promise.all([
      db.workspaceEmailUsage.findUnique({
        where: {
          organizationId_day: { organizationId: p.organizationId, day },
        },
      }),
      db.inbox.count({
        where: { organizationId: p.organizationId, status: "active" },
      }),
      db.phoneNumber.count({
        where: {
          organizationId: p.organizationId,
          status: { notIn: ["released", "failed"] },
        },
      }),
    ]);
    return c.json({
      policy: organization,
      usage: {
        day,
        emailSends: usage?.sends ?? 0,
        smsSends: usage?.smsSends ?? 0,
        inboxes,
        phoneNumbers,
      },
    });
  });
  app.patch("/v1/workspace/policy", async (c) => {
    const p = c.get("principal");
    assert(
      p.id === p.userId && p.role === "owner" && !p.impersonatedBy,
      403,
      "forbidden",
      "Only workspace owners using their own session can change limits",
    );
    const input = workspacePolicyInput.parse(await c.req.json());
    const policy = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${p.organizationId}))`;
      const saved = await tx.organization.update({
        where: { id: p.organizationId },
        data: { ...input, policyVersion: { increment: 1 } },
        select: {
          requireSmsApproval: true,
          requireEmailApproval: true,
          requireProvisioningApproval: true,
          dailyEmailLimit: true,
          dailySmsLimit: true,
          maxInboxes: true,
          maxPhoneNumbers: true,
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: p.organizationId,
          actorId: p.userId,
          action: "workspace.policy.updated",
          resourceId: p.organizationId,
        },
      });
      return saved;
    });
    return c.json({ policy });
  });
  app.get("/v1/connections", async (c) => {
    const p = c.get("principal");
    assert(
      p.id === p.userId,
      403,
      "forbidden",
      "Use your dashboard session to manage connections",
    );
    const connections = await db.oauthConsent.findMany({
      where: { userId: p.userId, referenceId: p.organizationId },
      select: {
        id: true,
        resourceGrants: true,
        dailyEmailLimit: true,
        dailySmsLimit: true,
        dailyInboxLimit: true,
        dailyNumberLimit: true,
        scopes: true,
        resources: true,
        createdAt: true,
        oauthclient: { select: { name: true, clientId: true } },
      },
    });
    return c.json({ data: connections });
  });
  app.patch("/v1/connections/:id/limits", async (c) => {
    const p = c.get("principal");
    assert(
      p.credential?.kind === "session" &&
        ["owner", "admin"].includes(p.role) &&
        !p.impersonatedBy,
      403,
      "forbidden",
      "Use your own owner or admin session to change connection limits",
    );
    const input = connectionLimitsInput.parse(await c.req.json());
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${p.organizationId}))`;
      const consent = await tx.oauthConsent.findFirst({
        where: {
          id: c.req.param("id"),
          userId: p.userId,
          referenceId: p.organizationId,
        },
      });
      assert(consent, 404, "not_found", "Connection not found");
      const updated = await tx.oauthConsent.update({
        where: { id: consent.id },
        data: input,
        select: {
          dailyEmailLimit: true,
          dailySmsLimit: true,
          dailyInboxLimit: true,
          dailyNumberLimit: true,
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: p.organizationId,
          actorId: p.userId,
          action: "connection.limits.updated",
          resourceId: consent.id,
        },
      });
      return updated;
    });
    return c.json(result);
  });
  app.delete("/v1/connections/:id", async (c) => {
    const p = c.get("principal");
    assert(
      p.id === p.userId && !p.impersonatedBy,
      403,
      "forbidden",
      "Use your own dashboard session to revoke connections",
    );
    const consent = await db.oauthConsent.findFirst({
      where: {
        id: c.req.param("id"),
        userId: p.userId,
        referenceId: p.organizationId,
      },
    });
    assert(consent, 404, "not_found", "Connection not found");
    const where = {
      clientId: consent.clientId,
      userId: p.userId,
      referenceId: p.organizationId,
    };
    await db.$transaction([
      db.oauthAccessToken.updateMany({ where, data: { revoked: new Date() } }),
      db.oauthRefreshToken.updateMany({ where, data: { revoked: new Date() } }),
      db.oauthConsent.deleteMany({ where }),
    ]);
    await audit(p, "connection.revoked", consent.id);
    return c.json({ revoked: true });
  });
  app.get("/v1/capabilities", (c) =>
    c.json({
      email: {
        provider: "resend",
        available: !!env.RESEND_API_KEY && !!env.EMAIL_DOMAIN,
        domain: env.EMAIL_DOMAIN,
      },
      phone: {
        provider: "telnyx",
        available:
          env.TELNYX_STATUS === "active" &&
          !!env.TELNYX_API_KEY &&
          !!env.TELNYX_MESSAGING_PROFILE_ID &&
          !!env.TELNYX_PUBLIC_KEY,
        status: env.TELNYX_STATUS ?? "under_review",
      },
      cards: { available: false, status: "deferred" },
    }),
  );
  app.get("/v1/agents", async (c) => {
    const p = c.get("principal");
    authorize(p, "agents:read");
    return c.json({
      data: await db.agent.findMany({
        where: {
          organizationId: p.organizationId,
          ...(p.agentId ? { id: p.agentId } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    });
  });
  app.post("/v1/agents", async (c) => {
    const p = c.get("principal");
    authorize(p, "agents:write", true);
    const input = agentInput.parse(await c.req.json());
    const project = await db.project.upsert({
      where: {
        organizationId_name: {
          organizationId: p.organizationId,
          name: "Default",
        },
      },
      create: { organizationId: p.organizationId, name: "Default" },
      update: {},
    });
    const agent = await db.agent.create({
      data: {
        ...input,
        organizationId: p.organizationId,
        projectId: project.id,
      },
    });
    await audit(p, "agent.created", agent.id);
    return c.json(agent, 201);
  });
  app.get("/v1/agents/:id/policy", async (c) => {
    const p = c.get("principal");
    authorize(p, "agents:read");
    ownedAgent(p, c.req.param("id"));
    const a = await db.agent.findFirst({
      where: { id: c.req.param("id"), organizationId: p.organizationId },
    });
    assert(a, 404, "not_found", "Agent not found");
    return c.json({
      dailySendLimit: a.dailySendLimit,
      dailySmsLimit: a.dailySmsLimit,
      allowedSmsRecipients: a.allowedSmsRecipients,
      maxInboxes: a.maxInboxes,
      allowedRecipients: a.allowedRecipients,
    });
  });
  app.patch("/v1/agents/:id/policy", async (c) => {
    const p = c.get("principal");
    authorize(p, "agents:write", true);
    assert(
      !p.impersonatedBy,
      403,
      "forbidden",
      "Stop impersonating to change policies",
    );
    const input = policyInput.parse(await c.req.json());
    const r = await db.agent.updateMany({
      where: { id: c.req.param("id"), organizationId: p.organizationId },
      data: input,
    });
    assert(r.count, 404, "not_found", "Agent not found");
    await audit(p, "policy.updated", c.req.param("id"));
    return c.json(input);
  });
  app.get("/v1/inboxes", async (c) => {
    const p = c.get("principal");
    authorize(p, "inboxes:read");
    const q = listInput.parse({ limit: 100, ...c.req.query() });
    if (q.cursor)
      assert(
        await db.inbox.findFirst({
          where: { id: q.cursor, ...resourceAccess(p, "inbox") },
          select: { id: true },
        }),
        400,
        "invalid_cursor",
        "Inbox cursor is unavailable",
      );
    const data = await db.inbox.findMany({
      where: resourceAccess(p, "inbox"),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: {
        _count: { select: { messages: true } },
        agent: { select: { name: true } },
      },
    });
    return c.json({
      data: data.slice(0, q.limit),
      nextCursor: data.length > q.limit ? data[q.limit - 1]!.id : null,
    });
  });
  app.post("/v1/inboxes", async (c) => {
    const p = c.get("principal");
    assert(
      !p.resourceGrants,
      403,
      "resource_restricted",
      "Selected-resource credentials cannot create inboxes",
    );
    authorize(p, "inboxes:write");
    assert(
      p.role !== "member",
      403,
      "forbidden",
      "Admin or delegated agent required",
    );
    const input = inboxInput.parse(await c.req.json());
    const agentId = input.agentId ?? p.agentId;
    if (agentId) ownedAgent(p, agentId);
    assert(
      env.EMAIL_DOMAIN,
      503,
      "not_configured",
      "Email domain not configured",
    );
    const key = c.req.header("Idempotency-Key");
    assert(
      key && key.length <= 200,
      400,
      "idempotency_key_required",
      "Provide an Idempotency-Key",
    );
    const requestHash = await hash(JSON.stringify(input));
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${p.organizationId}))`;
      const prior = await tx.operation.findUnique({
        where: {
          organizationId_principalId_route_key: {
            organizationId: p.organizationId,
            principalId: p.id,
            route: "inbox.create",
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
        return { response: prior.result };
      }
      const agent = agentId
        ? await tx.agent.findFirst({
            where: { id: agentId, organizationId: p.organizationId },
          })
        : null;
      if (agentId) assert(agent, 404, "not_found", "Agent not found");
      await assertInboxCapacity(tx, p.organizationId, agent);
      const address = `${input.localPart}@${env.EMAIL_DOMAIN}`;
      assert(
        !(await tx.inbox.findUnique({ where: { address } })),
        409,
        "address_unavailable",
        "This address is unavailable",
      );
      const policy = await tx.organization.findUniqueOrThrow({
        where: { id: p.organizationId },
      });
      let approvalId: string | undefined;
      if (
        policy.requireProvisioningApproval &&
        p.credential?.kind !== "session"
      ) {
        const approval = await requestActionApproval(tx, p, {
          route: "inbox.create",
          key,
          requestHash,
          resourceId: address,
          parameters: { ...input, address, ...(agentId ? { agentId } : {}) },
          policyVersion: policy.policyVersion,
        });
        if (approval.status !== "approved")
          return { approvalRequired: approval.id } as const;
        approvalId = approval.id;
      }
      await reserveCredentialUsage(
        tx,
        p,
        "inbox",
        new Date().toISOString().slice(0, 10),
      );
      const inbox = await tx.inbox.create({
        data: {
          name: input.name,
          agentId,
          address,
          organizationId: p.organizationId,
        },
      });
      const output = JSON.parse(JSON.stringify(inbox)) as Prisma.InputJsonValue;
      const operation = await tx.operation.create({
        data: {
          organizationId: p.organizationId,
          principalId: p.id,
          route: "inbox.create",
          key,
          requestHash,
          status: "completed",
          result: output,
          resourceId: inbox.id,
        },
      });
      await tx.event.create({
        data: {
          organizationId: p.organizationId,
          agentId: agent?.id,
          type: "inbox.created",
          resourceId: inbox.id,
        },
      });
      if (approvalId)
        await tx.approval.update({
          where: { id: approvalId },
          data: { status: "consumed", operationId: operation.id },
        });
      return { response: output };
    });
    if ("approvalRequired" in result)
      throw new AppError(
        409,
        "approval_required",
        "Ask a workspace owner or admin to review this inbox, then retry with the same idempotency key",
        false,
        { approvalId: result.approvalRequired! },
      );
    return c.json(result.response, 201);
  });
  app.patch("/v1/inboxes/:id", async (c) => {
    const p = c.get("principal");
    authorize(p, "inboxes:write");
    assert(
      p.role !== "member",
      403,
      "forbidden",
      "Admin or delegated agent required",
    );
    const input = z
      .object({ status: z.enum(["active", "archived"]) })
      .parse(await c.req.json());
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${p.organizationId}))`;
      const inbox = await tx.inbox.findFirst({
        where: { id: c.req.param("id"), ...resourceAccess(p, "inbox") },
        include: { agent: true },
      });
      assert(inbox, 404, "not_found", "Inbox not found");
      if (inbox.status === input.status) return;
      if (input.status === "active")
        await assertInboxCapacity(tx, p.organizationId, inbox.agent);
      await tx.inbox.update({ where: { id: inbox.id }, data: input });
      const action =
        input.status === "active" ? "inbox.reactivated" : "inbox.archived";
      await tx.event.create({
        data: {
          organizationId: p.organizationId,
          agentId: inbox.agentId,
          type: action,
          resourceId: inbox.id,
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: p.organizationId,
          actorId: p.userId,
          impersonatedBy: p.impersonatedBy,
          action,
          resourceId: inbox.id,
        },
      });
    });
    return c.json(input);
  });
  app.get("/v1/inboxes/:id/messages", async (c) => {
    const p = c.get("principal");
    authorize(p, "inboxes:read");
    const inbox = await db.inbox.findFirst({
      where: { id: c.req.param("id"), ...resourceAccess(p, "inbox") },
    });
    assert(inbox, 404, "not_found", "Inbox not found");
    const q = listInput.parse(c.req.query());
    const data = await db.emailMessage.findMany({
      where: {
        inboxId: inbox.id,
        organizationId: p.organizationId,
        ...(c.req.query("threadId")
          ? { threadId: c.req.query("threadId") }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        inboxId: true,
        subject: true,
        from: true,
        to: true,
        direction: true,
        status: true,
        unread: true,
        createdAt: true,
        threadId: true,
      },
    });
    return c.json({
      data: data.slice(0, q.limit),
      nextCursor: data.length > q.limit ? data[q.limit - 1]?.id : null,
    });
  });
  app.get("/v1/messages/:id", async (c) => {
    const p = c.get("principal");
    authorize(p, "inboxes:read");
    const message = await db.emailMessage.findFirst({
      where: {
        id: c.req.param("id"),
        organizationId: p.organizationId,
        inbox: resourceAccess(p, "inbox"),
      },
      select: {
        id: true,
        organizationId: true,
        inboxId: true,
        messageId: true,
        threadId: true,
        inReplyTo: true,
        references: true,
        replyTo: true,
        direction: true,
        status: true,
        from: true,
        to: true,
        subject: true,
        text: true,
        unread: true,
        createdAt: true,
        updatedAt: true,
        attachments: {
          select: {
            id: true,
            filename: true,
            contentType: true,
            size: true,
            objectKey: true,
            storageAttempts: true,
          },
        },
      },
    });
    assert(message, 404, "not_found", "Message not found");
    await audit(p, "message.read", message.id);
    return c.json({
      ...message,
      contentTrust: "untrusted",
      attachments: message.attachments.map(
        ({ objectKey, storageAttempts, ...attachment }) => ({
          ...attachment,
          storageStatus: !env.ATTACHMENTS
            ? "unavailable"
            : objectKey
              ? "ready"
              : storageAttempts >= 8
                ? "failed"
                : "pending",
        }),
      ),
    });
  });
  const findAttachment = async (p: Principal, id: string) => {
    const attachment = await db.attachment.findFirst({
      where: {
        id,
        OR: [
          { message: { organizationId: p.organizationId, inbox: resourceAccess(p, "inbox") } },
          { smsMessage: { organizationId: p.organizationId, phoneNumber: resourceAccess(p, "number") } },
        ],
      },
    });
    if (attachment) authorize(p, attachment.smsMessageId ? "sms:read" : "inboxes:read");
    assert(attachment, 404, "not_found", "Attachment not found");
    assert(
      env.ATTACHMENTS,
      503,
      "storage_unavailable",
      "Attachment storage is not configured",
    );
    assert(
      attachment.objectKey,
      409,
      "attachment_not_ready",
      "Attachment storage is pending or requires operator attention",
    );
    return attachment;
  };
  const downloadAttachment = async (p: Principal, id: string) => {
    const attachment = await findAttachment(p, id);
    const object = await env.ATTACHMENTS!.get(attachment.objectKey!);
    assert(object, 404, "not_found", "Attachment content not found");
    await audit(p, "attachment.downloaded", attachment.id);
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": attachmentDisposition(attachment.filename),
        "Content-Length": String(object.size),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "X-Content-Trust": "untrusted",
        "Referrer-Policy": "no-referrer",
      },
    });
  };
  app.get("/v1/attachments/:id/download", (c) =>
    downloadAttachment(c.get("principal"), c.req.param("id")),
  );
  app.post("/v1/attachments/:id/download-url", async (c) => {
    const p = c.get("principal");
    const attachment = await findAttachment(p, c.req.param("id"));
    assert(
      p.credential && auth.options.secret,
      503,
      "not_configured",
      "Attachment links are unavailable",
    );
    const signed = await issueAttachmentLink(auth.options.secret, {
      attachmentId: attachment.id,
      organizationId: p.organizationId,
      credential: p.credential,
      resourcePath,
      audience: auth.options.baseURL as string,
    });
    const url = new URL(
      `/v1/attachments/${encodeURIComponent(attachment.id)}/content`,
      auth.options.baseURL as string,
    );
    url.searchParams.set("token", signed.token);
    await audit(p, "attachment.link_created", attachment.id);
    return c.json({
      url: url.href,
      expiresAt: signed.expiresAt,
      contentTrust: "untrusted",
    });
  });
  const sendEmail: Handler<{
    Variables: { principal: Principal; requestId: string };
  }> = async (c) => {
    const p = c.get("principal");
    authorize(p, "email:send");
    assert(
      p.role !== "member",
      403,
      "forbidden",
      "Admin or delegated agent required",
    );
    const isReply = c.req.path.endsWith("/reply");
    const parent = isReply
      ? await db.emailMessage.findFirst({
          where: {
            id: c.req.param("id"),
            organizationId: p.organizationId,
            inbox: resourceAccess(p, "inbox"),
          },
        })
      : null;
    if (isReply) assert(parent, 404, "not_found", "Message not found");
    const body = await c.req.json();
    const input = parent
      ? sendEmailInput.parse({
          to:
            parent.direction === "outbound"
              ? parent.to
              : parent.replyTo.length
                ? parent.replyTo
                : [parent.from.match(/<([^<>]+)>\s*$/)?.[1] ?? parent.from],
          subject: /^re:/i.test(parent.subject)
            ? parent.subject
            : `Re: ${parent.subject}`,
          ...replyEmailInput.parse(body),
        })
      : sendEmailInput.parse(body);
    validateOutgoingAttachments(input.attachments, "email");
    const inbox = await db.inbox.findFirst({
      where: {
        id: parent?.inboxId ?? c.req.param("id"),
        ...resourceAccess(p, "inbox"),
        status: "active",
      },
      include: { agent: true },
    });
    assert(inbox, 404, "not_found", "Active inbox not found");
    const inReplyTo =
      parent?.messageId && /^<[^<>\r\n\s]+>$/.test(parent.messageId)
        ? parent.messageId
        : undefined;
    const references = [
      ...new Set([
        ...(parent?.references ?? []),
        ...(inReplyTo ? [inReplyTo] : []),
      ]),
    ]
      .filter((id) => /^<[^<>\r\n\s]+>$/.test(id))
      .slice(-20);
    const headers = inReplyTo
      ? { "In-Reply-To": inReplyTo, References: references.join(" ") }
      : undefined;
    if (inbox.agent?.allowedRecipients.length)
      assert(
        input.to.every((x) => inbox.agent!.allowedRecipients.includes(x)),
        403,
        "recipient_not_allowed",
        "Recipient not allowed by agent policy",
      );
    const key = c.req.header("Idempotency-Key");
    assert(
      key && key.length <= 200,
      400,
      "idempotency_key_required",
      "Provide an Idempotency-Key",
    );
    const route = parent
        ? `email.reply:${parent.id}`
        : `email.send:${inbox.id}`,
      requestHash = await hash(JSON.stringify(input));
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
      const currentInbox = await tx.inbox.findFirst({
        where: {
          id: inbox.id,
          ...resourceAccess(p, "inbox"),
          status: "active",
        },
        include: { agent: true },
      });
      assert(currentInbox, 404, "not_found", "Active inbox not found");
      assert(
        !currentInbox.agent?.allowedRecipients.length ||
          input.to.every((to) =>
            currentInbox.agent!.allowedRecipients.includes(to),
          ),
        403,
        "recipient_not_allowed",
        "Recipient not allowed by agent policy",
      );
      const policy = await tx.organization.findUniqueOrThrow({
        where: { id: p.organizationId },
      });
      let approvalId: string | undefined;
      if (policy.requireEmailApproval && p.credential?.kind !== "session") {
        const approval = await requestActionApproval(tx, p, {
          route,
          key,
          requestHash,
          resourceId: inbox.id,
          parameters: { ...input, attachments: attachmentSummary(input.attachments), from: currentInbox.address },
          policyVersion: policy.policyVersion,
        });
        if (approval.status !== "approved")
          return { approvalRequired: approval.id } as const;
        approvalId = approval.id;
      }
      const day = new Date().toISOString().slice(0, 10);
      await reserveCredentialSend(tx, p, "email", day);
      if (currentInbox.agentId && currentInbox.agent) {
        const usage = await tx.dailyUsage.upsert({
          where: { agentId_day: { agentId: currentInbox.agentId, day } },
          create: { agentId: currentInbox.agentId, day },
          update: {},
        });
        assert(
          usage.sends < currentInbox.agent.dailySendLimit,
          429,
          "quota_exceeded",
          "Daily send limit reached",
        );
        await tx.dailyUsage.update({
          where: { id: usage.id },
          data: { sends: { increment: 1 } },
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
          usage.sends < organization.dailyEmailLimit,
          429,
          "quota_exceeded",
          "Workspace daily send limit reached",
        );
        await tx.workspaceEmailUsage.update({
          where: { id: usage.id },
          data: { sends: { increment: 1 } },
        });
      }
      const billingMessageId = crypto.randomUUID();
      await reserveEmail(
        tx,
        p.organizationId,
        billingMessageId,
        input.to.length,
      );
      const stored = await storeOutgoingAttachments(env.ATTACHMENTS, p.organizationId, billingMessageId, input.attachments);
      const message = await tx.emailMessage.create({
        data: {
          organizationId: p.organizationId,
          id: billingMessageId,
          inboxId: inbox.id,
          direction: "outbound",
          status: "pending",
          from: inbox.address,
          ...input,
          attachments: { create: stored.records },
          threadId: parent?.threadId ?? crypto.randomUUID(),
          inReplyTo,
          references,
          unread: false,
        },
      });
      const op = await tx.operation.create({
        data: {
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
      return { ...op, replay: false };
    });
    if ("approvalRequired" in operation)
      throw new AppError(
        409,
        "approval_required",
        "Ask a workspace owner or admin to review this email, then retry with the same idempotency key",
        false,
        { approvalId: operation.approvalRequired! },
      );
    if (operation.replay)
      return c.json(
        {
          id: operation.id,
          status: operation.status,
          messageId: operation.resourceId,
          statusUrl: `/v1/operations/${operation.id}`,
        },
        ["pending", "unknown"].includes(operation.status) ? 202 : 200,
      );
    try {
      const result = await resendClient(env.RESEND_API_KEY).emails.send(
        {
          from: inbox.address,
          ...input,
          attachments: input.attachments?.map(({ contentType, ...file }) => ({ ...file, contentType })),
          headers,
          tags: [{ name: "papers_operation", value: operation.id }],
        },
        { idempotencyKey: operation.id },
      );
      if (result.error) {
        const status = result.error.statusCode;
        if (!status || status >= 500 || [408, 409, 429].includes(status))
          throw new Error("Ambiguous provider response");
        await db.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${operation.id}))`;
          const failed = await tx.operation.updateMany({
            where: { id: operation.id, status: { in: ["pending", "unknown"] } },
            data: { status: "failed", error: result.error!.name },
          });
          if (failed.count)
            await releaseEmail(tx, p.organizationId, operation.resourceId!);
          if (failed.count)
            await tx.emailMessage.updateMany({
              where: { id: operation.resourceId!, status: "pending" },
              data: { status: "failed" },
            });
        });
        throw new AppError(502, "provider_error", "Resend rejected this email");
      }
      if (!(await confirmEmailSend(db, operation.id, result.data!.id)))
        throw new Error("Provider correlation mismatch");
      return c.json(
        {
          id: operation.id,
          status: "completed",
          messageId: operation.resourceId,
          statusUrl: `/v1/operations/${operation.id}`,
        },
        201,
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      await db.operation.updateMany({
        where: { id: operation.id, status: "pending" },
        data: { status: "unknown", error: "provider_timeout" },
      });
      const current = await db.operation.findUniqueOrThrow({
        where: { id: operation.id },
      });
      return c.json(
        {
          id: operation.id,
          status: current.status,
          messageId: operation.resourceId,
          statusUrl: `/v1/operations/${operation.id}`,
        },
        ["pending", "unknown"].includes(current.status) ? 202 : 200,
      );
    }
  };
  app.post("/v1/inboxes/:id/messages", sendEmail);
  app.post("/v1/messages/:id/reply", sendEmail);
  app.patch("/v1/messages/:id", async (c) => {
    const p = c.get("principal");
    authorize(p, "inboxes:write");
    const input = messageUpdateInput.parse(await c.req.json());
    const r = await db.emailMessage.updateMany({
      where: {
        id: c.req.param("id"),
        organizationId: p.organizationId,
        inbox: resourceAccess(p, "inbox"),
      },
      data: input,
    });
    assert(r.count, 404, "not_found", "Message not found");
    return c.json(input);
  });
  app.get("/v1/inboxes/:id", async (c) => {
    const p = c.get("principal");
    authorize(p, "inboxes:read");
    const inbox = await db.inbox.findFirst({
      where: { id: c.req.param("id"), ...resourceAccess(p, "inbox") },
    });
    assert(inbox, 404, "not_found", "Inbox not found");
    return c.json(inbox);
  });
  app.get("/v1/agents/:id", async (c) => {
    const p = c.get("principal");
    authorize(p, "agents:read");
    ownedAgent(p, c.req.param("id"));
    const agent = await db.agent.findFirst({
      where: { id: c.req.param("id"), organizationId: p.organizationId },
    });
    assert(agent, 404, "not_found", "Agent not found");
    return c.json(agent);
  });
  app.get("/v1/operations/:id", async (c) => {
    const p = c.get("principal");
    const op = await db.operation.findFirst({
      where: {
        id: c.req.param("id"),
        organizationId: p.organizationId,
        ...(p.id !== p.userId ? { principalId: p.id } : {}),
      },
      select: {
        id: true,
        status: true,
        resourceId: true,
        error: true,
        result: true,
        createdAt: true,
      },
    });
    assert(op, 404, "not_found", "Operation not found");
    const { result, ...visible } = op;
    const failure = smsFailureSchema.safeParse(
      (result as { failure?: unknown } | null)?.failure,
    );
    return c.json({
      ...visible,
      ...(op.status !== "completed" && failure.success
        ? { failure: failure.data }
        : {}),
    });
  });
  app.get("/v1/events", async (c) => {
    const p = c.get("principal");
    authorize(p, "events:read");
    const q = listInput.parse(c.req.query());
    const data = p.resourceGrants
      ? await listGrantedEvents(db, p, q)
      : await db.event.findMany({
          where: filter(p),
          orderBy: { id: "asc" },
          take: q.limit + 1,
          ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        });
    return c.json({
      data: data.slice(0, q.limit),
      nextCursor: data.length
        ? data[Math.min(data.length, q.limit) - 1]?.id
        : null,
    });
  });
  app.get("/v1/api-keys", async (c) => {
    const p = c.get("principal");
    authorize(p, "agents:read", true);
    return c.json({
      data: await db.apiKey.findMany({
        where: { organizationId: p.organizationId },
        select: {
          id: true,
          name: true,
          resourceGrants: true,
          prefix: true,
          scopes: true,
          agentId: true,
          createdAt: true,
          dailyEmailLimit: true,
          dailySmsLimit: true,
          dailyInboxLimit: true,
          dailyNumberLimit: true,
          expiresAt: true,
          revokedAt: true,
        },
      }),
    });
  });
  app.post("/v1/api-keys", async (c) => {
    const p = c.get("principal");
    authorize(p, "agents:write", true);
    assert(
      !p.impersonatedBy,
      403,
      "forbidden",
      "Stop impersonating to create keys",
    );
    const input = keyInput.parse(await c.req.json());
    if (input.agentId)
      assert(
        await db.agent.findFirst({
          where: { id: input.agentId, organizationId: p.organizationId },
        }),
        404,
        "not_found",
        "Agent not found",
      );
    const resourceGrants = input.resourceGrants
      ? await validateResourceGrants(db, p, input.resourceGrants, input.agentId)
      : undefined;
    const token =
      "papers_" +
      Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
    const key = await db.apiKey.create({
      data: {
        organizationId: p.organizationId,
        createdBy: p.userId,
        name: input.name,
        resourceGrants,
        dailyEmailLimit: input.dailyEmailLimit,
        dailySmsLimit: input.dailySmsLimit,
        dailyInboxLimit: input.dailyInboxLimit,
        dailyNumberLimit: input.dailyNumberLimit,
        agentId: input.agentId,
        scopes: input.scopes,
        prefix: token.slice(0, 15),
        hash: await hash(token),
        expiresAt: new Date(Date.now() + input.expiresInDays * 86400000),
      },
    });
    await audit(p, "key.created", key.id);
    return c.json({ id: key.id, token, prefix: key.prefix }, 201);
  });
  app.delete("/v1/api-keys/:id", async (c) => {
    const p = c.get("principal");
    authorize(p, "agents:write", true);
    const r = await db.apiKey.updateMany({
      where: { id: c.req.param("id"), organizationId: p.organizationId },
      data: { revokedAt: new Date() },
    });
    assert(r.count, 404, "not_found", "Key not found");
    return c.json({ revoked: true });
  });
  app.get("/v1/phone-numbers", async (c) => {
    const p = c.get("principal");
    authorize(p, "numbers:read");
    const q = listInput.parse({ limit: 100, ...c.req.query() });
    if (q.cursor)
      assert(
        await db.phoneNumber.findFirst({
          where: { id: q.cursor, ...resourceAccess(p, "number") },
          select: { id: true },
        }),
        400,
        "invalid_cursor",
        "Phone number cursor is unavailable",
      );
    const data = await db.phoneNumber.findMany({
      where: resourceAccess(p, "number"),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        agentId: true,
        phoneNumber: true,
        status: true,
        lastError: true,
        createdAt: true,
      },
    });
    return c.json({
      data: data.slice(0, q.limit).map((n) => ({
        ...n,
        monthlyCost: "3.00",
        upfrontCost: "0.00",
        currency: "USD",
      })),
      nextCursor: data.length > q.limit ? data[q.limit - 1]!.id : null,
      status: env.TELNYX_STATUS ?? "under_review",
    });
  });
  app.get("/v1/phone-numbers/available", async (c) => {
    authorize(c.get("principal"), "numbers:read");
    const country = z
      .string()
      .regex(/^[A-Z]{2}$/)
      .parse(c.req.query("country") ?? "US");
    const inventory = await new TelnyxProvider(
      env.TELNYX_API_KEY,
      env.TELNYX_STATUS,
    ).search(country);
    return c.json({
      data: inventory.data
        .filter((q) => standardNumber(country, q))
        .map(retailNumber),
    });
  });
  app.get("/v1/phone-numbers/:id", async (c) => {
    const p = c.get("principal");
    authorize(p, "numbers:read");
    const number = await db.phoneNumber.findFirst({
      where: { id: c.req.param("id"), ...resourceAccess(p, "number") },
      select: {
        id: true,
        agentId: true,
        phoneNumber: true,
        status: true,
        createdAt: true,
      },
    });
    assert(number, 404, "not_found", "Phone number not found");
    return c.json(number);
  });
  app.get("/v1/phone-numbers/:id/messages", async (c) => {
    const p = c.get("principal");
    authorize(p, "sms:read");
    const number = await db.phoneNumber.findFirst({
      where: { id: c.req.param("id"), ...resourceAccess(p, "number") },
    });
    assert(number, 404, "not_found", "Phone number not found");
    const q = listInput.parse(c.req.query());
    const data = await db.smsMessage.findMany({
      where: { phoneNumberId: number.id, organizationId: p.organizationId },
      orderBy: { id: "desc" },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        phoneNumberId: true,
        segments: true,
        from: true,
        to: true,
        direction: true,
        status: true,
        unread: true,
        createdAt: true,
      },
    });
    const charges = await db.billingReservation.findMany({
      where: { id: { in: data.map((m) => m.id) }, status: "settled" },
    });
    const byId = new Map(charges.map((c) => [c.id, c.settledMicros]));
    return c.json({
      data: data.slice(0, q.limit).map((m) => ({
        ...m,
        costAmount: byId.has(m.id) ? retailAmount(byId.get(m.id)!) : null,
        costCurrency: byId.has(m.id) ? "USD" : null,
      })),
      nextCursor: data.length > q.limit ? data[q.limit - 1]?.id : null,
    });
  });
  app.post("/v1/phone-numbers/:id/messages", async (c) => {
    const result = await sendSms(
      db,
      env,
      c.get("principal"),
      c.req.param("id"),
      await c.req.json(),
      c.req.header("Idempotency-Key"),
      auth.options.baseURL as string,
    );
    return c.json(result.body, result.status);
  });
  app.get("/v1/sms/:id", async (c) => {
    const p = c.get("principal");
    authorize(p, "sms:read");
    const message = await db.smsMessage.findFirst({
      where: {
        id: c.req.param("id"),
        organizationId: p.organizationId,
        phoneNumber: resourceAccess(p, "number"),
      },
      select: {
        id: true,
        phoneNumberId: true,
        phoneNumber: { select: { messagingProfileId: true } },
        segments: true,
        from: true,
        to: true,
        text: true,
        attachments: { select: { id: true, filename: true, contentType: true, size: true, objectKey: true, storageAttempts: true } },
        direction: true,
        status: true,
        unread: true,
        createdAt: true,
      },
    });
    assert(message, 404, "not_found", "SMS message not found");
    await audit(p, "sms.read", message.id);
    const { phoneNumber, ...fields } = message;
    const charge = await db.billingReservation.findUnique({
      where: { id: message.id },
    });
    const publicMessage = {
      ...fields,
      attachments: message.attachments.map(({ objectKey, storageAttempts, ...file }) => ({ ...file, storageStatus: !env.ATTACHMENTS ? "unavailable" : objectKey ? "ready" : storageAttempts >= 8 ? "failed" : "pending" })),
      costAmount:
        charge?.status === "settled"
          ? retailAmount(charge.settledMicros)
          : null,
      costCurrency: charge?.status === "settled" ? "USD" : null,
    };
    const state = await db.providerSmsOptOut.findUnique({
      where: {
        messagingProfileId_recipient: {
          messagingProfileId: phoneNumber.messagingProfileId,
          recipient:
            message.direction === "inbound" ? message.from : message.to,
        },
      },
      select: { optedOut: true, occurredAt: true },
    });
    return c.json({
      ...publicMessage,
      contentTrust: "untrusted",
      recipientOptOut: {
        status: state
          ? state.optedOut
            ? "blocked"
            : "not_blocked"
          : "unknown",
        observedAt: state?.occurredAt ?? null,
      },
    });
  });
  app.post("/v1/phone-numbers", async (c) => {
    authorize(c.get("principal"), "numbers:provision");
    const selection = z
      .object({
        country: z.string().regex(/^[A-Z]{2}$/),
        phoneNumber: z.string().regex(/^\+[1-9]\d{6,14}$/),
        agentId: z.string().optional(),
      })
      .parse(await c.req.json());
    const quote = await selectedNumberQuote(
      env,
      selection.country,
      selection.phoneNumber,
    );
    const result = await provisionNumber(
      db,
      env,
      c.get("principal"),
      { ...quote, agentId: selection.agentId },
      c.req.header("Idempotency-Key"),
    );
    return c.json(result.body, result.status);
  });
  app.delete("/v1/phone-numbers/:id", async (c) => {
    const result = await releaseNumber(
      db,
      env,
      c.get("principal"),
      c.req.param("id"),
      c.req.header("Idempotency-Key"),
    );
    return c.json(result.body, result.status);
  });
  app.notFound((c) =>
    c.json(
      {
        error: {
          code: "not_found",
          message: "Endpoint not found",
          request_id: c.get("requestId"),
          retryable: false,
        },
      },
      404,
    ),
  );
  return app;
}
