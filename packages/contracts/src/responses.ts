import { smsFailureSchema, resourceGrantsSchema } from "./index";
import { z } from "zod";

const dateTime = z.iso.datetime({ offset: true });
const id = z.string().min(1);
const approvalAttachments = z
  .array(
    z.object({
      filename: z.string(),
      contentType: z.string(),
      size: z.number().int().nonnegative(),
    }),
  )
  .optional();
const emailParameters = z.object({
  attachments: approvalAttachments,
  from: z.string(),
  to: z.array(z.string()),
  subject: z.string(),
  text: z.string(),
});
const smsParameters = z.object({
  to: z.string(),
  text: z.string(),
  attachments: approvalAttachments,
});
const inboxParameters = z.object({
  name: z.string().optional(),
  username: z.string(),
  address: z.string(),
  agentId: id.optional(),
});
const numberParameters = z.object({
  phoneNumber: z.string(),
  country: z.string(),
  monthlyCost: z.string(),
  upfrontCost: z.string(),
  currency: z.string(),
  agentId: id.optional(),
});
export const approvalSchema = z.object({
  id,
  principalId: id,
  route: z.string(),
  resourceId: id,
  parameters: z.union([
    emailParameters,
    smsParameters,
    inboxParameters,
    numberParameters,
  ]),
  status: z.enum(["pending", "approved", "denied", "consumed"]),
  expiresAt: dateTime,
  policyVersion: z.number().int().positive(),
  decidedAt: dateTime.nullable(),
  operationId: id.nullable(),
  createdAt: dateTime,
});
export const approvalPageSchema = z.object({
  policyVersion: z.number().int().positive(),
  data: z.array(approvalSchema),
  nextCursor: id.nullable(),
});
export const approvalDecisionSchema = z.object({
  id,
  status: z.enum(["approved", "denied"]),
});
export const smsSummarySchema = z.object({
  id,
  phoneNumberId: id,
  from: z.string(),
  to: z.string(),
  direction: z.enum(["inbound", "outbound"]),
  status: z.string(),
  unread: z.boolean(),
  createdAt: dateTime,
  segments: z.number().int().positive().nullable(),
  costAmount: z
    .string()
    .regex(/^\d+(\.\d+)?([eE][+-]?\d+)?$/)
    .nullable(),
  costCurrency: z.string().nullable(),
});
export const attachmentInfoSchema = z.object({
  id,
  filename: z.string(),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  storageStatus: z.enum(["ready", "pending", "failed", "unavailable"]),
});
export const smsDetailSchema = smsSummarySchema.extend({
  attachments: z.array(attachmentInfoSchema),
  text: z.string(),
  contentTrust: z.literal("untrusted"),
  recipientOptOut: z.object({
    status: z.enum(["blocked", "not_blocked", "unknown"]),
    observedAt: dateTime.nullable(),
  }),
});
export const smsPageSchema = z.object({
  data: z.array(smsSummarySchema),
  nextCursor: id.nullable(),
});
export const validationIssueSchema = z.object({
  code: z.string(),
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    request_id: z.string(),
    retryable: z.boolean(),
    details: z
      .union([z.object({ approvalId: id }), z.array(validationIssueSchema)])
      .optional(),
  }),
});
export const operationStatusSchema = z
  .enum(["pending", "unknown", "completed", "failed"])
  .describe(
    "Operation state. Completed sends mean provider acceptance, not recipient delivery. Poll pending or unknown operations; do not resend with a new key.",
  );
export const operationSchema = z.object({
  id,
  status: operationStatusSchema,
  resourceId: id.nullable(),
  error: z.string().nullable(),
  createdAt: dateTime,
  failure: smsFailureSchema.optional(),
});
export const emailOperationSchema = z.object({
  id,
  status: operationStatusSchema,
  messageId: id.nullable(),
  statusUrl: z.string(),
});
export const smsOperationSchema = emailOperationSchema.extend({
  error: z.string().nullable(),
  failure: smsFailureSchema.optional(),
});
export const numberOperationSchema = z.object({
  id,
  status: operationStatusSchema,
  numberId: id.nullable(),
  error: z.string().nullable(),
  statusUrl: z.string(),
});
export const inboxSchema = z.object({
  id,
  organizationId: id,
  agentId: id.nullable(),
  name: z.string(),
  address: z.string(),
  status: z.string(),
  createdAt: dateTime,
});
export const inboxStatusSchema = z.object({
  status: z.enum(["active", "archived"]),
});
export const inboxListItemSchema = inboxSchema.extend({
  _count: z.object({ messages: z.number().int().nonnegative() }),
  agent: z.object({ name: z.string() }).nullable(),
});
export const inboxPageSchema = z.object({
  data: z.array(inboxListItemSchema),
  nextCursor: id.nullable(),
});
export const phoneNumberSchema = z.object({
  id,
  agentId: id.nullable(),
  phoneNumber: z.string(),
  status: z.string(),
  createdAt: dateTime,
});
export const phoneNumberListItemSchema = phoneNumberSchema.extend({
  lastError: z.string().nullable(),
  monthlyCost: z.string().nullable(),
  upfrontCost: z.string().nullable(),
  currency: z.string().nullable(),
});
export const phoneNumberPageSchema = z.object({
  data: z.array(phoneNumberListItemSchema),
  nextCursor: id.nullable(),
  status: z.string().describe("Telnyx account onboarding status."),
});
const numberPrice = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .describe("Papers retail price as an exact decimal string.");
export const availableNumberSchema = z.object({
  phone_number: z.string(),
  phone_number_type: z.string().optional(),
  cost_information: z.object({
    upfront_cost: numberPrice,
    monthly_cost: numberPrice.describe(
      "Recurring monthly rental price as an exact decimal string.",
    ),
    currency: z.string(),
  }),
  features: z.array(z.object({ name: z.string() })),
  region_information: z
    .array(
      z.object({
        region_name: z.string(),
        region_type: z.string(),
      }),
    )
    .optional(),
});
export const availableNumberResultsSchema = z.object({
  data: z.array(availableNumberSchema),
});
export const emailSummarySchema = z.object({
  id,
  inboxId: id,
  threadId: id,
  from: z.string(),
  to: z.array(z.string()),
  subject: z.string(),
  direction: z.enum(["inbound", "outbound"]),
  status: z.string(),
  unread: z.boolean(),
  createdAt: dateTime,
});
export const emailDetailSchema = emailSummarySchema.extend({
  organizationId: id,
  messageId: z.string().nullable(),
  inReplyTo: z.string().nullable(),
  references: z.array(z.string()),
  replyTo: z.array(z.string()),
  text: z.string(),
  updatedAt: dateTime,
  contentTrust: z.literal("untrusted"),
  attachments: z.array(attachmentInfoSchema),
});
export const emailPageSchema = z.object({
  data: z.array(emailSummarySchema),
  nextCursor: id.nullable(),
});
export const messageReadStateSchema = z.object({ unread: z.boolean() });
export const attachmentLinkSchema = z.object({
  url: z.url(),
  expiresAt: dateTime,
  contentTrust: z.literal("untrusted"),
});
const count = z.number().int().nonnegative();
export const workspacePolicySchema = z.object({
  requireSmsApproval: z.boolean(),
  requireEmailApproval: z.boolean(),
  requireProvisioningApproval: z.boolean(),
  dailyEmailLimit: count,
  dailySmsLimit: count,
  maxInboxes: count,
  maxPhoneNumbers: count,
});
export const workspacePolicyUpdateSchema = z.object({
  policy: workspacePolicySchema,
});
export const workspacePolicyResponseSchema = workspacePolicyUpdateSchema.extend(
  {
    usage: z.object({
      day: z.iso.date(),
      emailSends: count,
      smsSends: count,
      inboxes: count,
      phoneNumbers: count,
    }),
  },
);
export const workspaceUsageSchema = z.object({
  month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
  timezone: z.literal("UTC"),
  start: dateTime,
  endExclusive: dateTime,
  email: z.array(
    z.object({ direction: z.enum(["inbound", "outbound"]), messages: count }),
  ),
  sms: z.array(
    z.object({
      direction: z.enum(["inbound", "outbound"]),
      currency: z.string().nullable(),
      messages: count,
      messagesWithCost: count,
      messagesWithSegments: count,
      reportedSegments: count.nullable(),
      chargedAmount: smsSummarySchema.shape.costAmount,
    }),
  ),
  basis: z.literal("message_created_at"),
  costSource: z.literal("papers_ledger"),
  billingStatus: z.literal("prepaid"),
});
export const eventPageSchema = z.object({
  data: z.array(
    z.object({
      id,
      organizationId: id,
      agentId: id.nullable(),
      type: z.string(),
      resourceId: id,
      createdAt: dateTime,
    }),
  ),
  nextCursor: id
    .nullable()
    .describe(
      "Polling checkpoint: the last returned event ID, including on the final nonempty page. When null, retain the previous checkpoint for the next poll.",
    ),
});
const channelSendLimitSchema = z.object({
  dailyLimit: count,
  remaining: count,
  approvalRequired: z.boolean(),
});
export const sendLimitsSchema = z.object({
  day: z.iso.date(),
  resetsAt: dateTime,
  email: channelSendLimitSchema,
  sms: channelSendLimitSchema,
});
const provisioningAllowanceSchema = z.object({
  dailyLimit: count
    .nullable()
    .describe(
      "Credential daily creation cap; null means no additional credential cap.",
    ),
  capacityRemaining: count.describe(
    "Remaining resource slots under workspace and applicable legacy-agent limits.",
  ),
  remaining: count.describe(
    "Current creation allowance after daily usage, capacity and permissions. A snapshot, not a reservation or authorization.",
  ),
  approvalRequired: z.boolean(),
});
export const provisioningLimitsSchema = z.object({
  day: z.iso.date(),
  resetsAt: dateTime,
  inboxes: provisioningAllowanceSchema,
  phoneNumbers: provisioningAllowanceSchema,
});
export const identitySchema = z.object({
  resourceGrants: resourceGrantsSchema.nullable(),
  provisioningLimits: provisioningLimitsSchema,
  sendLimits: sendLimitsSchema,
  userId: id,
  organizationId: id,
  role: z.string(),
  agentId: id.optional(),
  scopes: z.array(z.string()),
  impersonatedBy: id.nullable().optional(),
});
export const capabilitiesSchema = z.object({
  email: z.object({
    provider: z.literal("resend"),
    available: z.boolean(),
    domain: z.string().optional(),
  }),
  phone: z.object({
    provider: z.literal("telnyx"),
    available: z.boolean(),
    status: z.string(),
  }),
  cards: z.object({
    available: z.literal(false),
    status: z.literal("deferred"),
  }),
});
export const responseSchemas = {
  Capabilities: capabilitiesSchema,
  WorkspacePolicyResponse: workspacePolicyResponseSchema,
  WorkspacePolicyUpdate: workspacePolicyUpdateSchema,
  WorkspaceUsage: workspaceUsageSchema,
  EventPage: eventPageSchema,
  Identity: identitySchema,
  Approval: approvalSchema,
  ApprovalPage: approvalPageSchema,
  ApprovalDecision: approvalDecisionSchema,
  SmsSummary: smsSummarySchema,
  SmsDetail: smsDetailSchema,
  SmsPage: smsPageSchema,
  Error: errorResponseSchema,
  Operation: operationSchema,
  EmailOperation: emailOperationSchema,
  SmsOperation: smsOperationSchema,
  NumberOperation: numberOperationSchema,
  Inbox: inboxSchema,
  InboxStatus: inboxStatusSchema,
  InboxListItem: inboxListItemSchema,
  InboxPage: inboxPageSchema,
  PhoneNumber: phoneNumberSchema,
  PhoneNumberListItem: phoneNumberListItemSchema,
  PhoneNumberPage: phoneNumberPageSchema,
  AvailableNumber: availableNumberSchema,
  AvailableNumberResults: availableNumberResultsSchema,
  AttachmentInfo: attachmentInfoSchema,
  AttachmentLink: attachmentLinkSchema,
  EmailSummary: emailSummarySchema,
  EmailDetail: emailDetailSchema,
  EmailPage: emailPageSchema,
  MessageReadState: messageReadStateSchema,
};
export const responseSchemaByOperation: Record<
  string,
  keyof typeof responseSchemas
> = {
  getWorkspacePolicy: "WorkspacePolicyResponse",
  updateWorkspacePolicy: "WorkspacePolicyUpdate",
  getWorkspaceUsage: "WorkspaceUsage",
  listEvents: "EventPage",
  getIdentity: "Identity",
  getCapabilities: "Capabilities",
  listApprovals: "ApprovalPage",
  approveAction: "ApprovalDecision",
  denyAction: "ApprovalDecision",
  listSmsMessages: "SmsPage",
  getSmsMessage: "SmsDetail",
  getOperation: "Operation",
  sendEmail: "EmailOperation",
  replyEmail: "EmailOperation",
  sendSms: "SmsOperation",
  provisionPhoneNumber: "NumberOperation",
  releasePhoneNumber: "NumberOperation",
  createInbox: "Inbox",
  getInbox: "Inbox",
  updateInbox: "InboxStatus",
  listInboxes: "InboxPage",
  listPhoneNumbers: "PhoneNumberPage",
  getPhoneNumber: "PhoneNumber",
  searchPhoneNumbers: "AvailableNumberResults",
  listMessages: "EmailPage",
  getMessage: "EmailDetail",
  setMessageUnread: "MessageReadState",
  createAttachmentDownloadUrl: "AttachmentLink",
};
