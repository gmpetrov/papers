import type { Prisma } from "@agentinfra/db";
import { assert } from "./errors";

// Call while holding the workspace advisory lock used by creation and policy updates.
export async function assertInboxCapacity(
  tx: Prisma.TransactionClient,
  organizationId: string,
  agent?: { id: string; maxInboxes: number } | null,
) {
  const organization = await tx.organization.findUniqueOrThrow({
    where: { id: organizationId },
  });
  assert(
    (await tx.inbox.count({ where: { organizationId, status: "active" } })) <
      organization.maxInboxes,
    409,
    "quota_exceeded",
    "Inbox limit reached",
  );
  if (agent)
    assert(
      (await tx.inbox.count({
        where: { organizationId, agentId: agent.id, status: "active" },
      })) < agent.maxInboxes,
      409,
      "quota_exceeded",
      "Agent inbox limit reached",
    );
}
