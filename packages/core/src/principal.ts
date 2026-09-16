import type { Database } from "@agentinfra/db";
import type { Auth } from "@agentinfra/auth";
import { hashOAuthToken } from "@agentinfra/auth";
import {
  scopes,
  resourceGrantsSchema,
  type Scope,
} from "@agentinfra/contracts";
import { assert, hash } from "./errors";
export interface Principal {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
  agentId?: string;
  oauthConsentId?: string;
  resourceGrants?: { inboxIds: string[]; phoneNumberIds: string[] };
  scopes: string[];
  impersonatedBy?: string | null;
  credential?: CredentialReference;
}
export type CredentialReference = {
  kind: "key" | "oauth" | "session";
  id: string;
};
// Internal only: callers must verify a signed capability before resolving a reference.
export async function authenticateReference(
  db: Database,
  auth: Auth,
  credential: CredentialReference,
  resourcePath: "/v1" | "/mcp",
) {
  return authenticate(
    db,
    auth,
    new Request(auth.options.baseURL as string),
    resourcePath,
    credential,
  );
}
export async function authenticate(
  db: Database,
  auth: Auth,
  request: Request,
  resourcePath: "/v1" | "/mcp" = "/v1",
  credential?: CredentialReference,
): Promise<Principal> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (authorization)
    assert(token, 401, "unauthorized", "Use a bearer access token");
  if (token || (credential && credential.kind !== "session")) {
    const key =
      credential?.kind === "oauth"
        ? null
        : await db.apiKey.findUnique({
            where:
              credential?.kind === "key"
                ? { id: credential.id }
                : { hash: await hash(token!) },
          });
    if (credential?.kind === "key")
      assert(key, 401, "unauthorized", "Invalid or expired API key");
    if (!key) {
      const grant = await db.oauthAccessToken.findUnique({
        where:
          credential?.kind === "oauth"
            ? { id: credential.id }
            : { token: await hashOAuthToken(token!) },
        include: {
          oauthclient: true,
          session: true,
          user: true,
          oauthrefreshtoken: true,
        },
      });
      const now = new Date();
      assert(
        grant &&
          !grant.revoked &&
          grant.expiresAt > now &&
          !grant.oauthclient.disabled &&
          grant.user &&
          !grant.user.banned &&
          grant.session &&
          grant.session.expiresAt > now &&
          !grant.session.impersonatedBy &&
          grant.referenceId,
        401,
        "unauthorized",
        "Invalid or expired access token",
      );
      // Sender-constrained tokens cannot be used as plain bearer credentials.
      assert(
        !grant.confirmation,
        401,
        "unauthorized",
        "A proof-bound token requires proof validation",
      );
      assert(
        !grant.oauthrefreshtoken?.revoked,
        401,
        "unauthorized",
        "The grant has been revoked",
      );
      assert(
        grant.resources.includes(
          new URL(resourcePath, auth.options.baseURL as string).href,
        ),
        401,
        "invalid_audience",
        "This token is not valid for this resource",
      );
      const resource = await db.oauthResource.findUnique({
        where: {
          identifier: new URL(resourcePath, auth.options.baseURL as string)
            .href,
        },
      });
      assert(
        resource && !resource.disabled,
        401,
        "unauthorized",
        "Resource access is unavailable",
      );
      const member = await db.member.findFirst({
        where: { organizationId: grant.referenceId, userId: grant.user.id },
      });
      assert(member, 403, "forbidden", "Organization membership required");
      const consent = await db.oauthConsent.findFirst({
        where: {
          clientId: grant.clientId,
          userId: grant.user.id,
          referenceId: grant.referenceId,
        },
      });
      assert(
        consent &&
          grant.scopes.every((scope) => consent.scopes.includes(scope)) &&
          consent.resources.includes(
            new URL(resourcePath, auth.options.baseURL as string).href,
          ),
        401,
        "unauthorized",
        "The connection no longer permits this access",
      );
      const resourceGrants =
        consent.resourceGrants == null
          ? null
          : resourceGrantsSchema.safeParse(consent.resourceGrants);
      assert(
        !resourceGrants || resourceGrants.success,
        401,
        "unauthorized",
        "Invalid resource grant configuration",
      );
      return {
        ...(resourceGrants?.success
          ? { resourceGrants: resourceGrants.data }
          : {}),
        credential: { kind: "oauth", id: grant.id },
        oauthConsentId: consent.id,
        id: `oauth:${consent.id}`,
        userId: grant.user.id,
        organizationId: grant.referenceId,
        role: member.role === "member" ? "member" : "agent",
        scopes: grant.scopes,
      };
    }
    assert(
      key && !key.revokedAt && key.expiresAt > new Date(),
      401,
      "unauthorized",
      "Invalid or expired API key",
    );
    const member = await db.member.findFirst({
      where: { organizationId: key.organizationId, userId: key.createdBy },
      include: { user: true },
    });
    assert(
      member && !member.user.banned,
      401,
      "unauthorized",
      "The key owner no longer has access",
    );
    const grants =
      key.resourceGrants == null
        ? null
        : resourceGrantsSchema.safeParse(key.resourceGrants);
    assert(
      !grants || grants.success,
      401,
      "unauthorized",
      "Invalid resource grant configuration",
    );
    return {
      ...(grants?.success ? { resourceGrants: grants.data } : {}),
      credential: { kind: "key", id: key.id },
      id: key.id,
      userId: key.createdBy,
      organizationId: key.organizationId,
      role: member.role === "member" ? "member" : "agent",
      agentId: key.agentId ?? undefined,
      scopes: key.scopes,
    };
  }
  const stored =
    credential?.kind === "session"
      ? await db.session.findUnique({
          where: { id: credential.id },
          include: { user: true },
        })
      : null;
  const session =
    credential?.kind === "session"
      ? stored && stored.expiresAt > new Date() && !stored.user.banned
        ? { session: stored, user: stored.user }
        : null
      : await auth.api.getSession({ headers: request.headers });
  assert(session, 401, "unauthorized", "Sign in to continue");
  const organizationId = session.session.activeOrganizationId;
  assert(
    organizationId,
    409,
    "organization_required",
    "Select an organization first",
  );
  const member = await db.member.findFirst({
    where: { organizationId, userId: session.user.id },
  });
  assert(member, 403, "forbidden", "Organization membership required");
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    assert(
      origin === new URL(auth.options.baseURL as string).origin,
      403,
      "invalid_origin",
      "A trusted origin is required for session mutations",
    );
  }
  return {
    credential: { kind: "session", id: session.session.id },
    id: session.user.id,
    userId: session.user.id,
    organizationId,
    role: member.role,
    scopes: [...scopes],
    impersonatedBy: session.session.impersonatedBy,
  };
}
export function authorize(p: Principal, scope: Scope, adminOnly = false) {
  assert(
    !p.resourceGrants ||
      !["agents:read", "agents:write", "numbers:provision"].includes(scope),
    403,
    "resource_restricted",
    "This credential is limited to its selected resources",
  );
  assert(
    p.scopes.includes(scope),
    403,
    "insufficient_scope",
    `Missing scope: ${scope}`,
  );
  if (adminOnly)
    assert(
      ["owner", "admin"].includes(p.role),
      403,
      "forbidden",
      "Organization admin access required",
    );
}
export function ownedAgent(p: Principal, agentId: string) {
  assert(
    !p.agentId || p.agentId === agentId,
    404,
    "not_found",
    "Resource not found",
  );
}
