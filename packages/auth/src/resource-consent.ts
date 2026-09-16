import { APIError } from "better-auth/api";
import { Prisma, type Database } from "@agentinfra/db";
import { resourceGrantsSchema } from "@agentinfra/contracts";

/** A request-scoped Prisma extension persists the human selection atomically
 * with Better Auth's consent write, before an authorization code is returned.
 * Better Auth remains responsible for signed consent state, CSRF and membership.
 */
export function resourceConsentDatabase(db: Database, input?: string) {
  if (input === undefined) return db;
  const selected = () => {
    try {
      if (input.length > 32768) throw new Error();
      const value = JSON.parse(input);
      if (value === null) return null;
      const grants = resourceGrantsSchema.parse(value);
      return {
        inboxIds: [...new Set(grants.inboxIds)].sort(),
        phoneNumberIds: [...new Set(grants.phoneNumberIds)].sort(),
      };
    } catch {
      throw new APIError("BAD_REQUEST", {
        message: "Invalid resource selection",
      });
    }
  };
  const validate = async (organizationId: string | null | undefined) => {
    const grants = selected();
    if (!organizationId)
      throw new APIError("BAD_REQUEST", { message: "Select a workspace" });
    if (grants) {
      const [inboxes, numbers] = await Promise.all([
        db.inbox.count({
          where: { organizationId, id: { in: grants.inboxIds } },
        }),
        db.phoneNumber.count({
          where: { organizationId, id: { in: grants.phoneNumberIds } },
        }),
      ]);
      if (
        inboxes !== grants.inboxIds.length ||
        numbers !== grants.phoneNumberIds.length
      )
        throw new APIError("BAD_REQUEST", {
          message:
            "One or more selected resources are unavailable in this workspace",
        });
    }
    return grants;
  };
  return db.$extends({
    query: {
      oauthConsent: {
        async create({ args, query }) {
          const grants = await validate(args.data.referenceId);
          args.data.resourceGrants = grants ?? Prisma.DbNull;
          return query(args);
        },
        async update({ args, query }) {
          const previous = await db.oauthConsent.findUnique({
            where: args.where,
          });
          if (!previous)
            throw new APIError("NOT_FOUND", {
              message: "Connection not found",
            });
          const grants = await validate(previous.referenceId);
          const stored = previous.resourceGrants;
          const normalized =
            stored == null ? null : resourceGrantsSchema.safeParse(stored);
          const prior =
            normalized && normalized.success
              ? {
                  inboxIds: [...new Set(normalized.data.inboxIds)].sort(),
                  phoneNumberIds: [
                    ...new Set(normalized.data.phoneNumberIds),
                  ].sort(),
                }
              : null;
          if (
            (normalized && !normalized.success) ||
            JSON.stringify(prior) !== JSON.stringify(grants)
          )
            throw new APIError("CONFLICT", {
              message:
                "Revoke the existing connection before changing its resource selection",
            });
          // Preserve selection and approval bindings across repeat consent.
          return query(args);
        },
      },
    },
  });
}
