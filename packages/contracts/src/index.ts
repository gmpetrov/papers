export {
  billingCheckoutInput,
  autoTopupInput,
  changePlanInput,
  plans,
  planFor,
  topupAmounts,
  type PlanId,
} from "./plans";
import { z } from "zod";
export const attachmentInfoSchema = z.object({
  id: z.string(),
  filename: z.string(),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  storageStatus: z.enum(["ready", "pending", "failed", "unavailable"]),
});
export type AttachmentInfo = z.infer<typeof attachmentInfoSchema>;
const webhookUrl = z
  .string()
  .url()
  .max(2048)
  .superRefine((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Use a valid HTTPS URL" });
      return;
    }
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      url.port ||
      !host.includes(".") ||
      /^[\d.]+$/.test(host) ||
      host.includes(":") ||
      /(^|\.)(localhost|local|internal|test|invalid|example)$/.test(host)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Use a public HTTPS domain without credentials, fragments, or a custom port",
      });
  })
  .transform((value) => new URL(value).href);
export const webhookEndpointInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    url: webhookUrl,
    eventTypes: z
      .array(z.string().regex(/^(email|sms|inbox|number)\.[a-z_]+$/))
      .min(1)
      .max(30)
      .transform((values) => [...new Set(values)]),
  })
  .strict();
export const webhookEndpointUpdateInput = webhookEndpointInput
  .extend({ enabled: z.boolean() })
  .partial()
  .refine(
    (input) => Object.keys(input).length > 0,
    "Provide at least one field",
  );
export const scopes = [
  "agents:read",
  "agents:write",
  "inboxes:read",
  "inboxes:write",
  "email:send",
  "numbers:read",
  "sms:read",
  "numbers:provision",
  "numbers:release",
  "sms:send",
  "events:read",
] as const;
export const scopeSchema = z.enum(scopes);
export const agentInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).default(""),
});
export const inboxInput = z.object({
  name: z.string().trim().min(1).max(80),
  localPart: z
    .string()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9._-]{2,40}$/),
  agentId: z.string().min(1).optional(),
});
// Canonical base64 keeps request hashes stable and rejects malformed input.
export const outgoingAttachmentInput = z.object({
  filename: z
    .string()
    .min(1)
    .max(180)
    .regex(/^[^\x00-\x1f\x7f/\\]+$/),
  contentType: z
    .string()
    .max(100)
    .regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i),
  content: z
    .string()
    .max(7_000_000)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
});
export const outgoingAttachmentsInput = z
  .array(outgoingAttachmentInput)
  .max(10)
  .optional();
export const sendEmailInput = z.object({
  attachments: outgoingAttachmentsInput,
  to: z.array(z.email()).min(1).max(10),
  subject: z.string().max(998),
  text: z.string().min(1).max(100_000),
});
export const replyEmailInput = z.object({
  attachments: outgoingAttachmentsInput,
  text: z.string().min(1).max(100_000),
});
export const messageUpdateInput = z.object({ unread: z.boolean() });
export const resourceGrantsSchema = z.strictObject({
  inboxIds: z.array(z.string().min(1)).max(100).default([]),
  phoneNumberIds: z.array(z.string().min(1)).max(100).default([]),
});
export const keyInput = z.object({
  resourceGrants: resourceGrantsSchema.nullable().optional(),
  dailyInboxLimit: z.number().int().min(0).max(10000).nullable().optional(),
  dailyNumberLimit: z.number().int().min(0).max(10000).nullable().optional(),
  dailyEmailLimit: z.number().int().min(0).max(10000).nullable().optional(),
  dailySmsLimit: z.number().int().min(0).max(10000).nullable().optional(),
  name: z.string().min(1).max(80),
  agentId: z.string().min(1).optional(),
  scopes: z.array(scopeSchema).min(1),
  expiresInDays: z.number().int().min(1).max(365).default(90),
});
export const listInput = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const policyInput = z.object({
  dailySmsLimit: z.number().int().min(0).max(10000).optional(),
  allowedSmsRecipients: z
    .array(z.string().regex(/^\+[1-9]\d{6,14}$/))
    .max(100)
    .optional(),
  dailySendLimit: z.number().int().min(0).max(10000),
  maxInboxes: z.number().int().min(0).max(1000),
  allowedRecipients: z.array(z.email()).max(100).default([]),
});
export const workspacePolicyInput = z.strictObject({
  requireSmsApproval: z.boolean().optional(),
  requireEmailApproval: z.boolean().optional(),
  requireProvisioningApproval: z.boolean().optional(),
  dailyEmailLimit: z.number().int().min(0).max(10000),
  dailySmsLimit: z.number().int().min(0).max(10000),
  maxInboxes: z.number().int().min(0).max(1000),
  maxPhoneNumbers: z.number().int().min(0).max(100),
});
export type WorkspacePolicy = z.infer<typeof workspacePolicyInput>;
export const numberSearchInput = z.object({
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .default("US"),
});
export const numberInput = z.object({
  country: z.string().regex(/^[A-Z]{2}$/),
  monthlyCost: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .default("3.00"),
  upfrontCost: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .default("0.00"),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default("USD"),
  phoneNumber: z.string().regex(/^\+[1-9]\d{6,14}$/),
  agentId: z.string().min(1).optional(),
});
export const smsInput = z.object({
  attachments: outgoingAttachmentsInput,
  to: z.string().regex(/^\+[1-9]\d{6,14}$/),
  text: z.string().min(1).max(1600),
});
export type Scope = z.infer<typeof scopeSchema>;
export type SendEmailInput = z.infer<typeof sendEmailInput>;

export const smsFailureSchema = z.object({
  kind: z.enum([
    "provider_http_error",
    "timeout",
    "connection_error",
    "invalid_provider_response",
    "confirmation_failed",
    "unexpected_error",
  ]),
  httpStatus: z.number().int().min(100).max(599).optional(),
  providerCodes: z.array(z.string().regex(/^\d{3,10}$/)).max(10),
});
export type SmsFailure = z.infer<typeof smsFailureSchema>;
export function describeSmsFailure(failure: SmsFailure): string {
  switch (failure.kind) {
    case "provider_http_error":
      if (failure.providerCodes.includes("20014"))
        return "Telnyx rejected the SMS because account verification is incomplete. Check Account > Verifications in Telnyx; international alphanumeric SMS requires Level 2 verification.";
      if (failure.providerCodes.includes("40306"))
        return "Telnyx rejected the SMS because the messaging profile has no alphanumeric sender ID. Configure an alphanumeric sender in Telnyx for international SMS.";
      return "Telnyx returned an error. Review the provider status and error codes below.";
    case "timeout":
      return "Telnyx did not respond before the request timed out. The send may still have been accepted.";
    case "connection_error":
      return "The connection to Telnyx failed. The send outcome is not confirmed.";
    case "invalid_provider_response":
      return "Telnyx returned an unexpected response. The send outcome is not confirmed.";
    case "confirmation_failed":
      return "Telnyx accepted the request, but saving its confirmation failed. Check the operation status.";
    default:
      return "The request encountered an unexpected error. The send outcome is not confirmed.";
  }
}

export const connectionLimitsInput = z
  .object({
    dailyInboxLimit: z.number().int().min(0).max(10000).nullable().optional(),
    dailyNumberLimit: z.number().int().min(0).max(10000).nullable().optional(),
    dailyEmailLimit: z.number().int().min(0).max(10000).nullable(),
    dailySmsLimit: z.number().int().min(0).max(10000).nullable(),
  })
  .strict();
