import type { Database } from "@agentinfra/db";
import type { Principal } from "./principal";

/** A snapshot for planning. Each action's transaction remains authoritative. */
export async function getCredentialLimits(db: Database, p: Principal) {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const resetsAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  ).toISOString();
  return db.$transaction(
    async (tx) => {
      const org = await tx.organization.findUniqueOrThrow({
        where: { id: p.organizationId },
      });
      const workspace = await tx.workspaceEmailUsage.findUnique({
        where: {
          organizationId_day: { organizationId: p.organizationId, day },
        },
      });
      const key =
        p.credential?.kind === "key"
          ? await tx.apiKey.findFirst({
              where: { id: p.credential.id, organizationId: p.organizationId },
            })
          : null;
      const keyUsage = key
        ? await tx.apiKeyDailyUsage.findUnique({
            where: { apiKeyId_day: { apiKeyId: key.id, day } },
          })
        : null;
      const agent = p.agentId
        ? await tx.agent.findFirst({
            where: { id: p.agentId, organizationId: p.organizationId },
          })
        : null;
      const agentUsage = agent
        ? await tx.dailyUsage.findUnique({
            where: { agentId_day: { agentId: agent.id, day } },
          })
        : null;
      const consent = p.oauthConsentId
        ? await tx.oauthConsent.findFirst({
            where: {
              id: p.oauthConsentId,
              userId: p.userId,
              referenceId: p.organizationId,
            },
          })
        : null;
      const connectionUsage = consent
        ? await tx.oAuthDailyUsage.findUnique({
            where: { consentId_day: { consentId: consent.id, day } },
          })
        : null;
      const channel = (kind: "email" | "sms") => {
        const email = kind === "email";
        const limits = [
          {
            limit: email ? org.dailyEmailLimit : org.dailySmsLimit,
            used: email ? (workspace?.sends ?? 0) : (workspace?.smsSends ?? 0),
          },
        ];
        const keyLimit = email ? key?.dailyEmailLimit : key?.dailySmsLimit;
        if (keyLimit != null)
          limits.push({
            limit: keyLimit,
            used: email
              ? (keyUsage?.emailSends ?? 0)
              : (keyUsage?.smsSends ?? 0),
          });
        const connectionLimit = email
          ? consent?.dailyEmailLimit
          : consent?.dailySmsLimit;
        if (connectionLimit != null)
          limits.push({
            limit: connectionLimit,
            used: email
              ? (connectionUsage?.emailSends ?? 0)
              : (connectionUsage?.smsSends ?? 0),
          });
        if (agent)
          limits.push({
            limit: email ? agent.dailySendLimit : agent.dailySmsLimit,
            used: email
              ? (agentUsage?.sends ?? 0)
              : (agentUsage?.smsSends ?? 0),
          });
        const permitted =
          p.role !== "member" &&
          p.scopes.includes(email ? "email:send" : "sms:send") &&
          (!p.resourceGrants ||
            (email
              ? p.resourceGrants.inboxIds
              : p.resourceGrants.phoneNumberIds
            ).length > 0);
        return {
          dailyLimit: Math.min(...limits.map((item) => item.limit)),
          remaining: permitted
            ? Math.max(
                0,
                Math.min(...limits.map((item) => item.limit - item.used)),
              )
            : 0,
          approvalRequired:
            p.credential?.kind !== "session" &&
            (email ? org.requireEmailApproval : org.requireSmsApproval),
        };
      };
      const inboxCount = await tx.inbox.count({
        where: { organizationId: p.organizationId, status: "active" },
      });
      const numberCount = await tx.phoneNumber.count({
        where: {
          organizationId: p.organizationId,
          status: { notIn: ["released", "failed"] },
        },
      });
      const agentInboxCount = agent
        ? await tx.inbox.count({
            where: {
              organizationId: p.organizationId,
              agentId: agent.id,
              status: "active",
            },
          })
        : 0;
      const provisioning = (kind: "inbox" | "number") => {
        const inbox = kind === "inbox";
        const capField = inbox ? "dailyInboxLimit" : "dailyNumberLimit";
        const usageField = inbox ? "inboxCreations" : "numberPurchases";
        const credential = key ?? consent;
        const usage = key ? keyUsage : connectionUsage;
        const dailyLimit = credential?.[capField] ?? null;
        const capacityRemaining = Math.max(
          0,
          inbox
            ? Math.min(
                org.maxInboxes - inboxCount,
                agent ? agent.maxInboxes - agentInboxCount : Infinity,
              )
            : org.maxPhoneNumbers - numberCount,
        );
        const permitted =
          p.role !== "member" &&
          !p.resourceGrants &&
          p.scopes.includes(inbox ? "inboxes:write" : "numbers:provision") &&
          (inbox || !p.impersonatedBy);
        return {
          dailyLimit,
          capacityRemaining,
          remaining: permitted
            ? Math.max(
                0,
                Math.min(
                  capacityRemaining,
                  dailyLimit === null
                    ? Infinity
                    : dailyLimit - (usage?.[usageField] ?? 0),
                ),
              )
            : 0,
          approvalRequired:
            p.credential?.kind !== "session" && org.requireProvisioningApproval,
        };
      };
      return {
        sendLimits: {
          day,
          resetsAt,
          email: channel("email"),
          sms: channel("sms"),
        },
        provisioningLimits: {
          day,
          resetsAt,
          inboxes: provisioning("inbox"),
          phoneNumbers: provisioning("number"),
        },
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
