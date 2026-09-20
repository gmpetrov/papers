import { responseSchemas, responseSchemaByOperation } from "./responses";
import { z } from "zod";
import {
  billingCheckoutInput,
  autoTopupInput,
  changePlanInput,
  connectionLimitsInput,
  smsInput,
  agentInput,
  numberInput,
  inboxInput,
  sendEmailInput,
  replyEmailInput,
  messageUpdateInput,
  policyInput,
  keyInput,
  workspacePolicyInput,
  webhookEndpointInput,
  webhookEndpointUpdateInput,
} from "./index";
type Endpoint = {
  method: string;
  path: string;
  id: string;
  summary: string;
  scope?: string;
  body?: z.ZodType;
  idempotent?: boolean;
  paginated?: boolean;
  admin?: boolean;
  description?: string;
  created?: boolean;
  unavailable?: boolean;
};
const endpoints: Endpoint[] = [
  {
    method: "get",
    path: "/billing",
    id: "getBilling",
    summary: "Read plan, prepaid balance and financial transactions",
    admin: true,
    description:
      "Owner/admin session outside impersonation. Money is returned as integer micro-USD strings.",
  },
  {
    method: "post",
    path: "/billing/checkout",
    id: "createBillingCheckout",
    summary: "Create a plan, phone rental or prepaid top-up checkout",
    admin: true,
    idempotent: true,
    body: billingCheckoutInput,
    description:
      "Owner session only, outside impersonation. Payment is collected by Stripe; redirect completion does not grant credit.",
  },
  {
    method: "post",
    path: "/billing/portal",
    id: "createBillingPortal",
    summary: "Open Stripe billing portal",
    admin: true,
    description: "Owner session only, outside impersonation.",
  },
  {
    method: "post",
    path: "/billing/plan",
    id: "changeBillingPlan",
    summary: "Upgrade now or schedule a downgrade at renewal",
    admin: true,
    body: changePlanInput,
    description: "Owner session only. Upgrades require successful payment.",
  },
  {
    method: "patch",
    path: "/billing/auto-topup",
    id: "updateAutoTopup",
    summary: "Opt in to automatic prepaid top-ups with a monthly ceiling",
    admin: true,
    body: autoTopupInput,
    description:
      "Owner session only, outside impersonation. Requires a previously saved payment method.",
  },
  {
    method: "patch",
    path: "/connections/{id}/limits",
    id: "updateConnectionLimits",
    summary: "Set your OAuth connection daily send limits",
    admin: true,
    body: connectionLimitsInput,
    description:
      "Own owner/admin session only, outside impersonation. Null inherits workspace limits. Zero blocks new sends. UTC counters survive token refresh and limit changes.",
  },
  {
    method: "get",
    path: "/approvals",
    id: "listApprovals",
    paginated: true,
    summary: "List recent approval requests",
    description:
      "Returns requests newest first with cursor pagination (default 25, maximum 100 per page). Credentials can read their own requests; owner/admin sessions can review workspace requests.",
  },
  {
    method: "post",
    path: "/approvals/{id}/approve",
    id: "approveAction",
    summary: "Approve an exact requested action",
    admin: true,
    description:
      "Owner/admin session outside impersonation required. Approval does not execute the action; the original principal retries the same request and key.",
  },
  {
    method: "post",
    path: "/approvals/{id}/deny",
    id: "denyAction",
    summary: "Deny a requested action",
    admin: true,
  },
  {
    method: "get",
    path: "/workspace/usage",
    id: "getWorkspaceUsage",
    summary: "Monthly workspace usage and reported SMS costs",
    admin: true,
    description:
      "Owner/admin sessions only. Optional month=YYYY-MM (UTC, default current month). Shows customer usage charges from the prepaid ledger; null means unsettled. Based on message creation time, not an invoice or provider billing period.",
  },
  {
    method: "get",
    path: "/webhook-endpoints/{id}/deliveries",
    id: "listWebhookDeliveries",
    summary: "List webhook delivery history",
    admin: true,
    paginated: true,
    description:
      "Owner/admin sessions only. Newest first. Excludes signing secrets, payloads, destination URLs, and receiver response bodies.",
  },
  {
    method: "get",
    path: "/webhook-endpoints/{id}/deliveries/{deliveryId}",
    id: "getWebhookDelivery",
    summary: "Read webhook delivery attempts",
    admin: true,
    description:
      "Owner/admin sessions only. Returns up to eight attempts with timestamps, HTTP statuses, and fixed error codes.",
  },
  {
    method: "get",
    path: "/webhook-endpoints",
    id: "listWebhookEndpoints",
    summary: "List workspace webhook endpoints",
    admin: true,
  },
  {
    method: "post",
    path: "/webhook-endpoints",
    id: "createWebhookEndpoint",
    summary: "Configure an inactive webhook endpoint",
    admin: true,
    created: true,
    body: webhookEndpointInput,
    description:
      "Returns signingSecret once. New endpoints are disabled; save the secret before enabling with PATCH.",
  },
  {
    method: "patch",
    path: "/webhook-endpoints/{id}",
    id: "updateWebhookEndpoint",
    summary: "Update or enable a webhook endpoint",
    admin: true,
    body: webhookEndpointUpdateInput,
  },
  {
    method: "delete",
    path: "/webhook-endpoints/{id}",
    id: "deleteWebhookEndpoint",
    summary: "Delete webhook endpoint",
    admin: true,
  },
  {
    method: "post",
    path: "/webhook-endpoints/{id}/rotate-secret",
    id: "rotateWebhookSecret",
    summary: "Rotate the webhook signing secret",
    admin: true,
    description:
      "Returns the new signingSecret once, retaining the prior secret for one hour. Repeated rotation during that hour returns 409.",
  },
  {
    method: "post",
    path: "/attachments/{id}/download-url",
    id: "createAttachmentDownloadUrl",
    summary: "Issue a private 60-second attachment link",
    description:
      "Requires inboxes:read for email or sms:read for MMS. Returns url, expiresAt, and contentTrust. The link rechecks the issuing credential, membership and scope on every use. Do not publish or log the URL.",
  },
  {
    method: "get",
    path: "/attachment-media/{id}",
    id: "downloadProviderMedia",
    summary: "Retrieve outbound MMS media using a provider capability",
    description:
      "Requires a one-hour bearer token issued only during MMS send. Returns the original MIME type with forced download. Invalid, expired, deleted or failed-message capabilities return 404. Never log or share this URL.",
  },
  {
    method: "get",
    path: "/attachments/{id}/content",
    id: "downloadLinkedAttachment",
    summary: "Redeem a short-lived signed attachment link",
    description:
      "Requires the signed token query parameter. Rechecks original credential access; expired or revoked links fail. Returns untrusted binary bytes.",
  },
  {
    method: "get",
    path: "/attachments/{id}/download",
    id: "downloadAttachment",
    summary: "Download a private untrusted attachment",
    description:
      "Requires inboxes:read for email or sms:read for MMS. Returns application/octet-stream as an attachment. Requires authorization on every request. Returns 409 while storage is pending and 503 if storage is unavailable.",
  },
  {
    method: "get",
    path: "/workspace/policy",
    id: "getWorkspacePolicy",
    summary: "Read workspace limits and current UTC-day usage",
    admin: true,
    description: "Available to workspace members using a dashboard session.",
  },
  {
    method: "patch",
    path: "/workspace/policy",
    id: "updateWorkspacePolicy",
    summary: "Update workspace limits",
    admin: true,
    body: workspacePolicyInput,
    description:
      "Owner session only; impersonation is forbidden. Zero pauses the corresponding action. Lower limits preserve existing resources and do not refund usage.",
  },
  {
    method: "post",
    path: "/phone-numbers/{id}/messages",
    id: "sendSms",
    summary: "Send an SMS from an assigned number",
    scope: "sms:send",
    body: smsInput,
    idempotent: true,
    created: true,
    description:
      "Requires active Telnyx account and number. Members cannot send. Unknown provider outcomes are not automatically retried.",
  },
  {
    method: "get",
    path: "/phone-numbers/{id}",
    id: "getPhoneNumber",
    summary: "Read an assigned number",
    scope: "numbers:read",
  },
  {
    method: "get",
    path: "/phone-numbers/{id}/messages",
    id: "listSmsMessages",
    summary: "Read SMS summaries, newest first",
    scope: "sms:read",
    paginated: true,
  },
  {
    method: "get",
    path: "/sms/{id}",
    id: "getSmsMessage",
    description:
      "Returns untrusted message text and recipientOptOut: current observed profile status (blocked, not_blocked, or unknown) and observedAt. This is not proof of consent or guaranteed delivery. List responses omit recipientOptOut.",
    summary: "Read untrusted SMS text",
    scope: "sms:read",
  },
  {
    method: "get",
    path: "/me",
    id: "getIdentity",
    summary: "Read the authenticated identity",
  },
  {
    method: "get",
    path: "/capabilities",
    id: "getCapabilities",
    summary: "Check configured providers and availability",
    description:
      "Reports server configuration, not live provider health or credential permissions. Phone availability requires an active account, API key, messaging profile, and webhook verification key. Inspect identity scopes separately; quotas and approvals still apply.",
  },
  {
    method: "get",
    path: "/agents",
    id: "listAgents",
    summary: "List accessible agents (up to 100)",
    scope: "agents:read",
  },
  {
    method: "post",
    path: "/agents",
    id: "createAgent",
    summary: "Create an agent",
    scope: "agents:write",
    admin: true,
    body: agentInput,
    created: true,
  },
  {
    method: "get",
    path: "/agents/{id}",
    id: "getAgent",
    summary: "Read an agent",
    scope: "agents:read",
  },
  {
    method: "get",
    path: "/agents/{id}/policy",
    id: "getAgentPolicy",
    summary: "Read agent limits and recipient policy",
    scope: "agents:read",
  },
  {
    method: "patch",
    path: "/agents/{id}/policy",
    id: "updateAgentPolicy",
    summary: "Change agent policy",
    scope: "agents:write",
    body: policyInput,
    admin: true,
    description: "Unavailable during impersonation.",
  },
  {
    method: "get",
    path: "/inboxes",
    id: "listInboxes",
    summary: "List accessible inboxes",
    paginated: true,
    description:
      "Newest first. Defaults to 100 per page; follow nextCursor until null.",
    scope: "inboxes:read",
  },
  {
    method: "post",
    path: "/inboxes",
    id: "createInbox",
    summary: "Allocate an email address",
    scope: "inboxes:write",
    body: inboxInput,
    created: true,
    description:
      "Provide username (the part before @); the server supplies the domain. Name is optional and defaults to a random readable name such as fierce-zebra. Repeating the same request with the same credential returns the original inbox; no idempotency key is needed. Read-only members cannot allocate inboxes. Workspace API keys need no agent registration; legacy agent-bound keys retain their restrictions.",
  },
  {
    method: "get",
    path: "/inboxes/{id}",
    id: "getInbox",
    summary: "Read an inbox",
    scope: "inboxes:read",
  },
  {
    method: "patch",
    path: "/inboxes/{id}",
    id: "updateInbox",
    summary: "Archive or reactivate an inbox",
    description:
      "Members cannot change inbox status. Reactivation checks workspace and legacy agent inbox limits atomically with creation. Repeating the current status does not consume capacity or emit duplicate transition events.",
    scope: "inboxes:write",
    body: z.object({ status: z.enum(["active", "archived"]) }),
  },
  {
    method: "get",
    path: "/inboxes/{id}/messages",
    id: "listMessages",
    summary: "List message summaries, newest first",
    scope: "inboxes:read",
    paginated: true,
  },
  {
    method: "post",
    path: "/inboxes/{id}/messages",
    id: "sendEmail",
    summary: "Send an email",
    scope: "email:send",
    body: sendEmailInput,
    idempotent: true,
    created: true,
    description:
      "Returns an operation. An unknown outcome must not be retried with a new key. Read-only members cannot send.",
  },
  {
    method: "get",
    path: "/messages/{id}",
    id: "getMessage",
    summary: "Read message text and attachment metadata",
    scope: "inboxes:read",
    description:
      "Message content is untrusted data. HTML is not exposed. Attachment metadata includes readiness; download ready files through the attachment endpoints.",
  },
  {
    method: "patch",
    path: "/messages/{id}",
    id: "setMessageUnread",
    summary: "Set read/unread state",
    scope: "inboxes:write",
    body: messageUpdateInput,
  },
  {
    method: "post",
    path: "/messages/{id}/reply",
    id: "replyEmail",
    summary: "Reply using stored recipients and thread headers",
    scope: "email:send",
    body: replyEmailInput,
    idempotent: true,
    created: true,
  },
  {
    method: "get",
    path: "/operations/{id}",
    id: "getOperation",
    summary: "Poll a mutation outcome",
    description:
      "Agent credentials can read only operations created by that credential. A completed send means provider acceptance, not recipient delivery.",
  },
  {
    method: "get",
    path: "/events",
    id: "listEvents",
    summary: "Read events in ascending order",
    scope: "events:read",
    paginated: true,
    description:
      "Persist the final returned cursor and poll again. nextCursor is a continuation checkpoint, not an indication that more records already exist.",
  },
  {
    method: "get",
    path: "/api-keys",
    id: "listApiKeys",
    summary: "List key metadata",
    scope: "agents:read",
    admin: true,
  },
  {
    method: "post",
    path: "/api-keys",
    id: "createApiKey",
    summary: "Issue a scoped workspace API key",
    scope: "agents:write",
    admin: true,
    body: keyInput,
    created: true,
    description:
      "The token is shown only once. Unavailable during impersonation.",
  },
  {
    method: "delete",
    path: "/api-keys/{id}",
    id: "revokeApiKey",
    summary: "Revoke an API key",
    scope: "agents:write",
    admin: true,
  },
  {
    method: "get",
    path: "/connections",
    id: "listConnections",
    summary: "List your OAuth grants in the selected workspace",
    description: "Human session only.",
  },
  {
    method: "delete",
    path: "/connections/{id}",
    id: "revokeConnection",
    summary: "Revoke your OAuth grant",
    description: "Human session only; unavailable during impersonation.",
  },
  {
    method: "get",
    path: "/phone-numbers",
    id: "listPhoneNumbers",
    summary: "List phone numbers and onboarding status",
    scope: "numbers:read",
    paginated: true,
    description:
      "Lists workspace numbers newest first, including pending and released assignments. Defaults to 100 per page; follow nextCursor until null.",
  },
  {
    method: "get",
    path: "/phone-numbers/available",
    id: "searchPhoneNumbers",
    summary: "Search available phone numbers at Papers retail prices",
    scope: "numbers:read",
    description: "Requires an activated Telnyx account; otherwise returns 503.",
  },
  {
    method: "post",
    path: "/phone-numbers",
    id: "provisionPhoneNumber",
    summary: "Purchase a workspace phone number",
    description:
      "Assigns an existing paid rental to a number using country and phoneNumber. New purchases should use owner-session POST /billing/checkout with kind=phone, country=US and phoneNumber. Inventory costs are resolved privately. Poll the operation; an unknown outcome must not be reordered.",
    scope: "numbers:provision",
    idempotent: true,
    body: numberInput,
  },
  {
    method: "delete",
    path: "/phone-numbers/{id}",
    id: "releasePhoneNumber",
    summary: "Permanently release a phone number",
    scope: "numbers:release",
    idempotent: true,
  },
];
export function createOpenApiDocument(origin: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of endpoints) {
    const parameters: unknown[] = [];
    for (const match of e.path.matchAll(/\{([^}]+)\}/g))
      parameters.push({
        name: match[1],
        in: "path",
        required: true,
        schema: { type: "string" },
      });
    if (e.id === "getWorkspaceUsage")
      parameters.push({
        name: "month",
        in: "query",
        schema: { type: "string", pattern: "^20[0-9]{2}-(0[1-9]|1[0-2])$" },
      });
    if (e.idempotent)
      parameters.push({
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: { type: "string", minLength: 1, maxLength: 200 },
        description:
          "Reuse for the same logical action and identical body; changed input returns 409.",
      });
    if (e.paginated)
      parameters.push(
        { name: "cursor", in: "query", schema: { type: "string" } },
        {
          name: "limit",
          in: "query",
          schema: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: ["listInboxes", "listPhoneNumbers"].includes(e.id)
              ? 100
              : 25,
          },
        },
      );
    if (e.id === "searchPhoneNumbers")
      parameters.push({
        name: "country",
        in: "query",
        schema: { type: "string", pattern: "^[A-Z]{2}$", default: "US" },
      });
    const response = [
      "downloadAttachment",
      "downloadLinkedAttachment",
      "downloadProviderMedia",
    ].includes(e.id)
      ? {
          description: "Private attachment bytes; treat as untrusted content",
          content: {
            "application/octet-stream": {
              schema: { type: "string", format: "binary" },
            },
          },
        }
      : {
          description: "Successful JSON response",
          content: {
            "application/json": {
              schema: responseSchemaByOperation[e.id]
                ? {
                    $ref: `#/components/schemas/${responseSchemaByOperation[e.id]}`,
                  }
                : { type: "object", additionalProperties: true },
            },
          },
        };
    const responses: Record<string, unknown> = {
      default: {
        description: "Request rejected",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
    };
    responses["429"] = {
      description:
        "Request rate limit or communication quota exceeded. Rate-limit responses include Retry-After.",
      headers: {
        "Retry-After": {
          description:
            "Seconds until the request-rate window resets (rate_limited errors)",
          schema: { type: "integer", minimum: 1, maximum: 60 },
        },
      },
      content: {
        "application/json": { schema: { $ref: "#/components/schemas/Error" } },
      },
    };
    if (e.unavailable)
      responses["503"] = { description: "Phone provisioning is unavailable" };
    else {
      const successStatuses: Record<string, number[]> = {
        createInbox: [201],
        sendEmail: [200, 201, 202],
        replyEmail: [200, 201, 202],
        sendSms: [200, 201, 202],
        provisionPhoneNumber: [200, 202],
        releasePhoneNumber: [200, 202],
      };
      const statuses = successStatuses[e.id] ?? [
        200,
        ...(e.created ? [201] : []),
        ...(e.idempotent ? [202] : []),
      ];
      for (const status of statuses)
        responses[String(status)] =
          status === 202
            ? {
                ...response,
                description:
                  "Operation pending or outcome unknown; poll the returned statusUrl. Do not submit a new idempotency key.",
              }
            : response;
    }
    (paths[e.path] ??= {})[e.method] = {
      operationId: e.id,
      ...(["downloadLinkedAttachment", "downloadProviderMedia"].includes(e.id)
        ? { security: [{ attachmentLink: [] }] }
        : {}),
      ...(e.admin || e.path.startsWith("/connections")
        ? { security: [{ sessionCookie: [] }] }
        : {}),
      summary: e.summary,
      description: [
        e.description,
        e.scope ? `Required scope: ${e.scope}.` : "",
        e.admin && !e.path.startsWith("/workspace/")
          ? "Requires a human owner/admin session; agent API keys and delegated OAuth cannot administer the workspace."
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      parameters,
      responses,
      ...(e.body
        ? {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: z.toJSONSchema(e.body, { io: "input" }),
                },
              },
            },
          }
        : {}),
      ...(e.scope ? { "x-required-scopes": [e.scope] } : {}),
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Papers API",
      version: "0.1.0",
      description:
        "Development API for agent email and phone infrastructure. Approval, email, SMS, inbox, attachment, operation, identity, workspace policy, usage, and event response schemas are typed; other response schemas remain permissive. Request schemas are generated from runtime Zod contracts. Cards are deferred.",
    },
    servers: [{ url: new URL("/v1", origin).href }],
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      securitySchemes: {
        attachmentLink: {
          type: "apiKey",
          in: "query",
          name: "token",
          description:
            "Short-lived signed attachment capability; never log or publish.",
        },
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name:
            new URL(origin).protocol === "https:"
              ? "__Secure-better-auth.session_token"
              : "better-auth.session_token",
          description:
            "Better Auth session with selected organization. Mutations also require the trusted Origin header.",
        },
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "Workspace API key or delegated OAuth access token with /v1 resource audience. Administrative routes require the Better Auth browser session instead.",
        },
      },
      schemas: Object.fromEntries(
        Object.entries(responseSchemas).map(([name, schema]) => [
          name,
          z.toJSONSchema(schema, { io: "output" }),
        ]),
      ),
    },
  };
}
