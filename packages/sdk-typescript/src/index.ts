export interface Agent {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  dailySendLimit: number;
  maxInboxes: number;
}
export interface Inbox {
  id: string;
  agentId: string | null;
  name: string;
  address: string;
  status: "active" | "archived";
  createdAt: string;
}
export interface InboxListItem extends Inbox {
  organizationId: string;
  _count: { messages: number };
  agent: { name: string } | null;
}
export interface NumberPurchaseInput {
  phoneNumber: string;
  country: string;
  monthlyCost: string;
  upfrontCost: string;
  currency: string;
  agentId?: string;
}
export interface AvailableNumber {
  phone_number: string;
  phone_number_type?: string;
  cost_information: {
    upfront_cost: string;
    monthly_cost: string;
    currency: string;
  };
  features: { name: string }[];
  region_information?: { region_name: string; region_type: string }[];
}
export interface NumberOperation {
  id: string;
  status: string;
  numberId: string;
  error?: string | null;
  statusUrl: string;
}
export interface PhoneNumber {
  id: string;
  agentId: string | null;
  phoneNumber: string;
  status: string;
  createdAt: string;
}
export interface PhoneNumberListItem extends PhoneNumber {
  lastError: string | null;
  monthlyCost: string | null;
  upfrontCost: string | null;
  currency: string | null;
}
export interface SmsRecipientOptOut {
  status: "blocked" | "not_blocked" | "unknown";
  observedAt: string | null;
}
export interface SmsMessage {
  /** Present on message detail; current observed profile state, not proof of consent. */
  recipientOptOut?: SmsRecipientOptOut;
  segments: number | null;
  costAmount: string | null;
  costCurrency: string | null;
  id: string;
  phoneNumberId: string;
  from: string;
  to: string;
  text?: string;
  direction: "inbound" | "outbound";
  status: string;
  unread: boolean;
  createdAt: string;
  contentTrust?: "untrusted";
}
export interface Message {
  attachments?: AttachmentInfo[];
  id: string;
  inboxId: string;
  from: string;
  to: string[];
  subject: string;
  text?: string;
  unread: boolean;
  replyTo?: string[];
  contentTrust?: "untrusted";
  direction: "inbound" | "outbound";
  status: string;
  createdAt: string;
  threadId: string;
}
export interface AttachmentInfo {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  storageStatus: "ready" | "pending" | "failed" | "unavailable";
}
export interface SmsFailure {
  kind:
    | "provider_http_error"
    | "timeout"
    | "connection_error"
    | "invalid_provider_response"
    | "confirmation_failed"
    | "unexpected_error";
  httpStatus?: number;
  providerCodes: string[];
}
export interface Operation {
  failure?: SmsFailure;
  id: string;
  status: string;
  messageId?: string;
  resourceId?: string;
  error?: string | null;
}
export interface Event {
  id: string;
  type: string;
  resourceId: string;
  agentId?: string | null;
  createdAt: string;
}
export interface Page<T> {
  data: T[];
  nextCursor?: string | null;
}
export interface MutationOptions {
  idempotencyKey: string;
}
export interface PaginationOptions {
  cursor?: string;
  limit?: number;
}
function pageQuery(cursor?: string, limit?: number) {
  if (
    limit !== undefined &&
    (!Number.isInteger(limit) || limit < 1 || limit > 100)
  )
    throw new RangeError("limit must be an integer between 1 and 100");
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (limit !== undefined) params.set("limit", String(limit));
  return params.size ? `?${params}` : "";
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export interface Approval {
  id: string;
  principalId: string;
  route: string;
  resourceId: string;
  parameters: Record<string, unknown>;
  status: string;
  expiresAt: string;
  policyVersion: number;
  decidedAt: string | null;
  operationId: string | null;
  createdAt: string;
}
export interface ValidationIssue {
  code: string;
  path: (string | number)[];
  message: string;
}
export type ErrorDetails = { approvalId: string } | ValidationIssue[];
function errorDetails(value: unknown): ErrorDetails | undefined {
  if (isObject(value) && typeof value.approvalId === "string")
    return { approvalId: value.approvalId };
  if (!Array.isArray(value)) return undefined;
  const issues: ValidationIssue[] = [];
  for (const issue of value) {
    if (
      !isObject(issue) ||
      typeof issue.code !== "string" ||
      typeof issue.message !== "string" ||
      !Array.isArray(issue.path) ||
      !issue.path.every(
        (part: unknown) =>
          typeof part === "string" ||
          (typeof part === "number" && Number.isFinite(part)),
      )
    )
      return undefined;
    issues.push({ code: issue.code, path: issue.path, message: issue.message });
  }
  return issues;
}
export class PapersError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public retryable = false,
    public details?: ErrorDetails,
    public retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "PapersError";
  }
}
export interface ClientOptions {
  apiKey: string;
  signal?: AbortSignal;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}
export interface ProvisioningAllowance {
  dailyLimit: number | null;
  capacityRemaining: number;
  remaining: number;
  approvalRequired: boolean;
}
export class Papers {
  private options: Required<Omit<ClientOptions, "fetch" | "signal">> & {
    signal?: AbortSignal;
    fetch: typeof fetch;
  };
  constructor(options: ClientOptions) {
    this.options = {
      baseUrl: "https://dev.chaindesk.ai",
      timeoutMs: 15000,
      fetch: globalThis.fetch,
      ...options,
    };
  }
  private async fetchResponse(
    path: string,
    method = "GET",
    body?: unknown,
    options?: MutationOptions,
  ): Promise<Response> {
    return this.options.fetch(
      `${this.options.baseUrl.replace(/\/$/, "")}/v1${path}`,
      {
        method,
        redirect: "error",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
          ...(options ? { "Idempotency-Key": options.idempotencyKey } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: this.options.signal
          ? AbortSignal.any([
              this.options.signal,
              AbortSignal.timeout(this.options.timeoutMs),
            ])
          : AbortSignal.timeout(this.options.timeoutMs),
      },
    );
  }
  async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    options?: MutationOptions,
  ): Promise<T> {
    const r = await this.fetchResponse(path, method, body, options);
    if (r.status === 204) return undefined as T;
    const data: unknown = await r.json().catch(() => undefined);
    const error = isObject(data) && isObject(data.error) ? data.error : {};
    if (!r.ok)
      throw new PapersError(
        r.status,
        typeof error.code === "string" ? error.code : "http_error",
        typeof error.message === "string"
          ? error.message
          : `Request failed (${r.status})`,
        typeof error.request_id === "string"
          ? error.request_id
          : (r.headers.get("X-Request-Id") ?? undefined),
        error.retryable === true,
        errorDetails(error.details),
        retryAfterSeconds(r.headers),
      );
    if (!isObject(data))
      throw new PapersError(
        r.status,
        "invalid_response",
        "Expected a JSON object from Papers",
        r.headers.get("X-Request-Id") ?? undefined,
      );
    return data as T;
  }
  me = () =>
    this.request<{
      userId: string;
      organizationId: string;
      role: string;
      impersonatedBy?: string | null;
      resourceGrants: { inboxIds: string[]; phoneNumberIds: string[] } | null;
      provisioningLimits: {
        day: string;
        resetsAt: string;
        inboxes: ProvisioningAllowance;
        phoneNumbers: ProvisioningAllowance;
      };
      sendLimits: {
        day: string;
        resetsAt: string;
        email: {
          dailyLimit: number;
          remaining: number;
          approvalRequired: boolean;
        };
        sms: {
          dailyLimit: number;
          remaining: number;
          approvalRequired: boolean;
        };
      };
      agentId?: string;
      scopes: string[];
    }>("/me");
  capabilities = () =>
    this.request<{
      email: { provider: "resend"; available: boolean; domain?: string };
      phone: { provider: "telnyx"; available: boolean; status: string };
      cards: { available: false; status: "deferred" };
    }>("/capabilities");
  agents = {
    get: (id: string) =>
      this.request<Agent>(`/agents/${encodeURIComponent(id)}`),
    list: () => this.request<Page<Agent>>("/agents"),
  };
  inboxes = {
    get: (id: string) =>
      this.request<Inbox>(`/inboxes/${encodeURIComponent(id)}`),
    list: (cursor?: string, limit?: number) =>
      this.request<Page<InboxListItem>>(`/inboxes${pageQuery(cursor, limit)}`),
    create: (
      input: { name: string; localPart: string; agentId?: string },
      options: MutationOptions,
    ) => this.request<Inbox>("/inboxes", "POST", input, options),
    archive: (id: string) =>
      this.request<{ status: "archived" }>(
        `/inboxes/${encodeURIComponent(id)}`,
        "PATCH",
        {
          status: "archived",
        },
      ),
    reactivate: (id: string) =>
      this.request<{ status: "active" }>(
        `/inboxes/${encodeURIComponent(id)}`,
        "PATCH",
        {
          status: "active",
        },
      ),
  };
  messages = {
    reply: (id: string, input: { text: string }, options: MutationOptions) =>
      this.request<Operation>(
        `/messages/${encodeURIComponent(id)}/reply`,
        "POST",
        input,
        options,
      ),
    setUnread: (id: string, unread: boolean) =>
      this.request<{ unread: boolean }>(
        `/messages/${encodeURIComponent(id)}`,
        "PATCH",
        { unread },
      ),
    list: (inboxId: string, cursor?: string, limit?: number) =>
      this.request<Page<Message>>(
        `/inboxes/${encodeURIComponent(inboxId)}/messages${pageQuery(cursor, limit)}`,
      ),
    get: (id: string) =>
      this.request<Message>(`/messages/${encodeURIComponent(id)}`),
    send: (
      inboxId: string,
      input: { to: string[]; subject: string; text: string },
      options: MutationOptions,
    ) =>
      this.request<Operation>(
        `/inboxes/${encodeURIComponent(inboxId)}/messages`,
        "POST",
        input,
        options,
      ),
  };
  operations = {
    get: (id: string) =>
      this.request<Operation>(`/operations/${encodeURIComponent(id)}`),
  };
  attachments = {
    getDownloadUrl: (id: string) =>
      this.request<{
        url: string;
        expiresAt: string;
        contentTrust: "untrusted";
      }>(`/attachments/${encodeURIComponent(id)}/download-url`, "POST"),
    download: async (
      id: string,
      options: { maxBytes?: number } = {},
    ): Promise<Uint8Array> => {
      const maxBytes = options.maxBytes ?? 25 * 1024 * 1024;
      if (
        !Number.isSafeInteger(maxBytes) ||
        maxBytes < 0 ||
        maxBytes > 25 * 1024 * 1024
      )
        throw new RangeError(
          "maxBytes must be an integer between 0 and 26214400",
        );
      const response = await this.fetchResponse(
        `/attachments/${encodeURIComponent(id)}/download`,
      );
      if (!response.ok) {
        const data: unknown = await response.json().catch(() => undefined);
        const error = isObject(data) && isObject(data.error) ? data.error : {};
        throw new PapersError(
          response.status,
          typeof error.code === "string" ? error.code : "http_error",
          typeof error.message === "string"
            ? error.message
            : "Attachment download failed",
          typeof error.request_id === "string"
            ? error.request_id
            : (response.headers.get("X-Request-Id") ?? undefined),
          error.retryable === true,
          errorDetails(error.details),
          retryAfterSeconds(response.headers),
        );
      }
      if (
        response.headers.get("Content-Type")?.split(";")[0] !==
          "application/octet-stream" ||
        !response.body
      ) {
        await response.body?.cancel().catch(() => {});
        throw new PapersError(
          response.status,
          "invalid_response",
          "Expected attachment bytes",
        );
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        if (Number(response.headers.get("Content-Length")) > maxBytes)
          throw new PapersError(
            response.status,
            "attachment_too_large",
            "Attachment exceeds maxBytes",
          );
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes)
            throw new PapersError(
              response.status,
              "attachment_too_large",
              "Attachment exceeds maxBytes",
            );
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes;
    },
  };
  numbers = {
    provision: (input: NumberPurchaseInput, options: MutationOptions) =>
      this.request<NumberOperation>("/phone-numbers", "POST", input, options),
    release: (id: string, options: MutationOptions) =>
      this.request<NumberOperation>(
        `/phone-numbers/${encodeURIComponent(id)}`,
        "DELETE",
        undefined,
        options,
      ),
    list: (cursor?: string, limit?: number) =>
      this.request<Page<PhoneNumberListItem> & { status: string }>(
        `/phone-numbers${pageQuery(cursor, limit)}`,
      ),
    get: (id: string) =>
      this.request<PhoneNumber>(`/phone-numbers/${encodeURIComponent(id)}`),
    search: (country = "US") =>
      this.request<{ data: AvailableNumber[] }>(
        `/phone-numbers/available?country=${encodeURIComponent(country)}`,
      ),
  };
  sms = {
    send: (
      numberId: string,
      input: { to: string; text: string },
      options: MutationOptions,
    ) =>
      this.request<Operation>(
        `/phone-numbers/${encodeURIComponent(numberId)}/messages`,
        "POST",
        input,
        options,
      ),
    list: (numberId: string, cursor?: string, limit?: number) =>
      this.request<Page<SmsMessage>>(
        `/phone-numbers/${encodeURIComponent(numberId)}/messages${pageQuery(cursor, limit)}`,
      ),
    get: (id: string) =>
      this.request<SmsMessage>(`/sms/${encodeURIComponent(id)}`),
  };
  approvals = {
    list: (cursor?: string, limit?: number) =>
      this.request<Page<Approval> & { policyVersion: number }>(
        `/approvals${pageQuery(cursor, limit)}`,
      ),
  };
  events = {
    list: (cursor?: string, limit?: number) =>
      this.request<Page<Event>>(`/events${pageQuery(cursor, limit)}`),
  };
  private async *iterate<T>(
    load: (cursor?: string) => Promise<Page<T>>,
    cursor?: string,
  ): AsyncGenerator<T> {
    const seen = new Set<string>();
    if (cursor) seen.add(cursor);
    while (true) {
      const page = await load(cursor);
      yield* page.data;
      if (!page.data.length || !page.nextCursor || seen.has(page.nextCursor))
        return;
      cursor = page.nextCursor;
      seen.add(cursor);
    }
  }
  iterateInboxes(options: PaginationOptions = {}) {
    return this.iterate(
      (cursor) => this.inboxes.list(cursor, options.limit),
      options.cursor,
    );
  }
  iteratePhoneNumbers(options: PaginationOptions = {}) {
    return this.iterate(
      (cursor) => this.numbers.list(cursor, options.limit),
      options.cursor,
    );
  }
  iterateMessages(inboxId: string, options: PaginationOptions = {}) {
    return this.iterate(
      (cursor) => this.messages.list(inboxId, cursor, options.limit),
      options.cursor,
    );
  }
  iterateSms(numberId: string, options: PaginationOptions = {}) {
    return this.iterate(
      (cursor) => this.sms.list(numberId, cursor, options.limit),
      options.cursor,
    );
  }
  iterateEvents(options: PaginationOptions = {}) {
    return this.iterate(
      (cursor) => this.events.list(cursor, options.limit),
      options.cursor,
    );
  }
}

export { verifyWebhook, WebhookVerificationError } from "./webhooks";

function retryAfterSeconds(headers: Headers): number | undefined {
  const value = headers.get("Retry-After");
  if (!value || !/^\d+$/.test(value)) return undefined;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}
