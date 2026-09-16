import type { Database } from "@agentinfra/db";

// Both the HTTP response and a signed provider webhook can win this race.
export async function confirmEmailSend(
  db: Database,
  operationId: string,
  providerId: string,
  messageId?: string,
  from?: string,
) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${operationId}))`;
    const operation = await tx.operation.findUnique({
      where: { id: operationId },
    });
    if (
      !operation?.resourceId ||
      !/^email\.(send|reply):/.test(operation.route)
    )
      return false;
    await tx.$queryRaw`SELECT id FROM "EmailMessage" WHERE id = ${operation.resourceId} FOR UPDATE`;
    const message = await tx.emailMessage.findFirst({
      where: {
        id: operation.resourceId,
        organizationId: operation.organizationId,
        direction: "outbound",
      },
      include: { inbox: true },
    });
    if (
      !message ||
      (from && from !== message.from) ||
      (message.providerId && message.providerId !== providerId)
    )
      return false;
    await tx.emailMessage.update({
      where: { id: message.id },
      data: {
        providerId,
        ...(messageId ? { messageId } : {}),
        ...(message.status === "pending" ? { status: "sent" } : {}),
      },
    });
    if (operation.status !== "completed") {
      await tx.operation.update({
        where: { id: operation.id },
        data: { status: "completed", error: null },
      });
      await tx.event.create({
        data: {
          organizationId: message.organizationId,
          agentId: message.inbox.agentId,
          type: "email.sent",
          resourceId: message.id,
        },
      });
    }
    return true;
  });
}
