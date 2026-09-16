import type { Prisma } from "@agentinfra/db";

type Evidence = {
  webhookUrl: string;
  from: string;
  to: string[];
  text: string | null | undefined;
  messagingProfileId: string;
};
/** The response and signed webhook use the same lock and confirmation path. */
export async function confirmSmsSend(
  tx: Prisma.TransactionClient,
  operationId: string,
  providerId: string,
  evidence?: Evidence,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${operationId}))`;
  const operation = await tx.operation.findUnique({
    where: { id: operationId },
  });
  if (!operation?.resourceId || !operation.route.startsWith("sms.send:"))
    return false;
  if (evidence) {
    const result = operation.result as { webhookUrl?: string } | null;
    // Only a URL in the signature-verified body is evidence. Ignore request query parameters.
    if (!result?.webhookUrl || result.webhookUrl !== evidence.webhookUrl)
      return false;
  }
  await tx.$queryRaw`SELECT id FROM "SmsMessage" WHERE id = ${operation.resourceId} FOR UPDATE`;
  const message = await tx.smsMessage.findFirst({
    where: {
      id: operation.resourceId,
      organizationId: operation.organizationId,
      direction: "outbound",
    },
    include: { phoneNumber: true },
  });
  if (
    !message ||
    operation.route !== `sms.send:${message.phoneNumberId}` ||
    (message.providerId && message.providerId !== providerId)
  )
    return false;
  if (
    evidence &&
    (evidence.from !== message.from ||
      evidence.to.length !== 1 ||
      evidence.to[0] !== message.to ||
      evidence.text !== message.text ||
      evidence.messagingProfileId !== message.phoneNumber.messagingProfileId)
  )
    return false;
  await tx.smsMessage.update({
    where: { id: message.id },
    data: {
      providerId,
      ...(message.status === "pending" ? { status: "queued" } : {}),
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
        agentId: message.phoneNumber.agentId,
        type: "sms.queued",
        resourceId: message.id,
      },
    });
  }
  return true;
}
