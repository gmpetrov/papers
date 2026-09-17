import { planFor } from "@agentinfra/contracts";
import { authErrorDiagnostics } from "./error-diagnostics";
import { resourceConsentDatabase } from "./resource-consent";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin, organization } from "better-auth/plugins";
import { hashOAuthToken, oauthScopes } from "./oauth";
export { hashOAuthToken, oauthScopes } from "./oauth";
import {
  createAuthMiddleware,
  getSessionFromCtx,
  APIError,
} from "better-auth/api";
import { oauthProvider } from "@better-auth/oauth-provider";
import type { Database } from "@agentinfra/db";
import { sendAccountEmail } from "@agentinfra/providers";
export interface AuthEnvironment {
  BILLING_ENABLED?: string;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
}
export function createAuth(
  db: Database,
  env: AuthEnvironment,
  selection?: { organizationId?: string; resourceGrants?: string },
) {
  const mail = (to: string, subject: string, text: string) =>
    sendAccountEmail(
      env.RESEND_API_KEY,
      env.AUTH_EMAIL_FROM,
      to,
      subject,
      text,
    );
  return betterAuth({
    appName: "Papers",
    onAPIError: {
      onError(error) {
        if (error instanceof APIError && error.statusCode < 500) return;
        console.error(
          JSON.stringify({
            event: "auth_request_failed",
            errors: authErrorDiagnostics(error),
          }),
        );
      },
    },
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: prismaAdapter(
      resourceConsentDatabase(db, selection?.resourceGrants),
      { provider: "postgresql", transaction: true },
    ),
    trustedOrigins: [env.BETTER_AUTH_URL],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) =>
        mail(
          user.email,
          "Reset your Papers password",
          `Reset your password: ${url}`,
        ),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) =>
        mail(
          user.email,
          "Verify your Papers account",
          `Verify your email: ${url}`,
        ),
    },
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {},
    session: { cookieCache: { enabled: false } },
    account: {
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    disabledPaths: ["/token"],
    plugins: [
      admin({ impersonationSessionDuration: 900 }),
      organization({
        membershipLimit: async (_user, organization) => {
          const billing = await db.billingAccount.findUnique({
            where: { organizationId: organization.id },
          });
          return billing
            ? planFor(
                billing.status === "active" &&
                  billing.periodEnd &&
                  billing.periodEnd > new Date()
                  ? billing.plan
                  : "free",
              ).seats
            : 100;
        },
        teams: { enabled: true },
        requireEmailVerificationOnInvitation: true,
        sendInvitationEmail: async (data) =>
          mail(
            data.email,
            `Join ${data.organization.name} on Papers`,
            `You've been invited to ${data.organization.name}. Accept: ${env.BETTER_AUTH_URL}/invite/${data.id}`,
          ),
        organizationHooks: {
          beforeUpdateMemberRole: async ({ newRole }) => {
            if (!["owner", "admin", "member"].includes(newRole))
              throw new APIError("BAD_REQUEST", {
                message: "Choose one role: owner, admin, or member",
              });
          },
          beforeCreateInvitation: async ({ invitation, inviter }) => {
            if (!["owner", "admin", "member"].includes(invitation.role))
              throw new APIError("BAD_REQUEST", {
                message: "Choose one role: owner, admin, or member",
              });
            if (invitation.role.includes("owner")) {
              const m = await db.member.findFirst({
                where: {
                  organizationId: invitation.organizationId,
                  userId: inviter.id,
                },
              });
              if (m?.role !== "owner")
                throw new APIError("FORBIDDEN", {
                  message: "Only owners may invite owners",
                });
            }
          },
          afterCreateOrganization: async ({ organization }) => {
            if (env.BILLING_ENABLED === "true")
              await db.billingAccount.upsert({
                where: { organizationId: organization.id },
                create: { organizationId: organization.id },
                update: {},
              });
            await db.project.create({
              data: { organizationId: organization.id, name: "Default" },
            });
          },
        },
      }),
      oauthProvider({
        disableJwtPlugin: true,
        grantTypes: ["authorization_code", "refresh_token"],
        storeTokens: { hash: hashOAuthToken },
        accessTokenExpiresIn: 900,
        clientRegistrationRequirePKCE: true,
        allowUnauthenticatedClientRegistration: true,
        clientPrivileges: async ({ user }) => user?.role === "admin",
        resources: ["/mcp", "/v1"].map((path) => ({
          identifier: new URL(path, env.BETTER_AUTH_URL).href,
          allowedScopes: oauthScopes,
        })),
        clientRegistrationDefaultResources: ["/mcp", "/v1"].map(
          (path) => new URL(path, env.BETTER_AUTH_URL).href,
        ),
        enforcePerClientResources: true,
        loginPage: "/login",
        consentPage: "/consent",
        scopes: oauthScopes,
        allowDynamicClientRegistration: true,
        postLogin: {
          page: "/select-organization",
          shouldRedirect: async () => !selection?.organizationId,
          consentReferenceId: async ({ session, user }) => {
            const id =
              selection?.organizationId ?? session?.activeOrganizationId;
            if (typeof id !== "string")
              throw new APIError("BAD_REQUEST", {
                message: "Select an organization",
              });
            if (
              !(await db.member.findFirst({
                where: { userId: user.id, organizationId: id },
              }))
            )
              throw new APIError("FORBIDDEN", {
                message: "Organization membership required",
              });
            return id;
          },
        },
        customAccessTokenClaims: async ({ user, referenceId }) => {
          if (
            !user ||
            !referenceId ||
            !(await db.member.findFirst({
              where: { userId: user.id, organizationId: referenceId },
            }))
          )
            throw new APIError("FORBIDDEN", {
              message: "Organization membership required",
            });
          return { organization_id: referenceId };
        },
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          !ctx.path.startsWith("/organization/") &&
          !ctx.path.startsWith("/oauth2/")
        )
          return;
        const session = await getSessionFromCtx(ctx);
        if (
          session &&
          [
            "/organization/update-member-role",
            "/organization/remove-member",
          ].includes(ctx.path)
        ) {
          const orgId =
            ctx.body?.organizationId ?? session.session.activeOrganizationId;
          const actor = await db.member.findFirst({
            where: { userId: session.user.id, organizationId: orgId },
          });
          const target = await db.member.findFirst({
            where: {
              organizationId: orgId,
              OR: [
                { id: ctx.body?.memberId ?? ctx.body?.memberIdOrEmail ?? "" },
                { user: { email: ctx.body?.memberIdOrEmail ?? "" } },
              ],
            },
          });
          if (
            actor?.role !== "owner" &&
            (target?.role === "owner" || ctx.body?.role === "owner")
          )
            throw new APIError("FORBIDDEN", {
              message: "Only owners can manage ownership",
            });
        }
        if (session?.session.impersonatedBy && ctx.path.startsWith("/oauth2/"))
          throw new APIError("FORBIDDEN", {
            message: "OAuth consent is unavailable while impersonating",
          });
      }),
    },
  });
}
export type Auth = ReturnType<typeof createAuth>;
