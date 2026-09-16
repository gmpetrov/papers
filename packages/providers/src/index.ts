import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { Resend } from "resend";
import { Webhook } from "svix";
import { z } from "zod";
export { Resend };
export function resendClient(key?: string) {
  if (!key) throw new Error("RESEND_API_KEY is not configured");
  return new Resend(key);
}
export async function sendAccountEmail(
  key: string | undefined,
  from: string | undefined,
  to: string,
  subject: string,
  text: string,
) {
  if (!from) throw new Error("AUTH_EMAIL_FROM is not configured");
  const result = await resendClient(key).emails.send({
    from,
    to,
    subject,
    text,
  });
  if (result.error) throw new Error("Account email delivery failed");
}
const eventSchema = z.object({
  type: z.string(),
  created_at: z.string(),
  data: z
    .object({
      email_id: z.string(),
      to: z.array(z.string()).optional(),
      received_for: z.array(z.string()).optional(),
      from: z.string().optional(),
      subject: z.string().optional(),
      message_id: z.string().optional(),
      tags: z.record(z.string(), z.string()).optional(),
    })
    .passthrough(),
});
export function verifyResendWebhook(
  payload: string,
  headers: Headers,
  secret: string,
) {
  new Webhook(secret).verify(payload, {
    "svix-id": headers.get("svix-id") ?? "",
    "svix-timestamp": headers.get("svix-timestamp") ?? "",
    "svix-signature": headers.get("svix-signature") ?? "",
  });
  return eventSchema.parse(JSON.parse(payload));
}
export type ResendEvent = z.infer<typeof eventSchema>;
export class ProviderUnavailable extends Error {
  constructor(public provider: string) {
    super(`${provider} is not active`);
  }
}
export class ProviderHttpError extends Error {
  constructor(
    public status: number,
    public codes: string[] = [],
  ) {
    super(`Provider request failed (${status})`);
  }
}
const cost = z.string().regex(/^\d+(\.\d+)?$/);
const availableNumbersSchema = z.object({
  data: z.array(
    z.object({
      phone_number: z.string(),
      phone_number_type: z.string().optional(),
      cost_information: z.object({
        upfront_cost: cost,
        monthly_cost: cost,
        currency: z.string(),
      }),
      features: z.array(z.object({ name: z.string() })),
      region_information: z
        .array(z.object({ region_name: z.string(), region_type: z.string() }))
        .optional(),
    }),
  ),
});
const orderSchema = z.object({
  id: z.string(),
  status: z.string(),
  customer_reference: z.string().nullable().optional(),
  requirements_met: z.boolean().optional(),
  phone_numbers: z
    .array(
      z.object({
        phone_number: z.string(),
        status: z.string().optional(),
        requirements_met: z.boolean().optional(),
      }),
    )
    .default([]),
});
const orderResponseSchema = z.object({ data: orderSchema });
const ownedNumberSchema = z.object({
  id: z.string(),
  phone_number: z.string(),
  status: z.string().optional(),
});
export class TelnyxProvider {
  constructor(
    private key?: string,
    private status = "under_review",
  ) {}
  private async request(path: string, method = "GET", body?: unknown) {
    if (this.status !== "active" || !this.key)
      throw new ProviderUnavailable("telnyx");
    const response = await fetch(`https://api.telnyx.com/v2${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      const codes = z
        .object({ errors: z.array(z.object({ code: z.string() })) })
        .safeParse(result);
      throw new ProviderHttpError(
        response.status,
        codes.success ? codes.data.errors.map((e) => e.code) : [],
      );
    }
    if (response.status === 204) return {};
    return response.json();
  }
  async listOptOuts(profileId: string, page = 1) {
    const query = new URLSearchParams({
      "filter[messaging_profile_id]": profileId,
      "page[number]": String(z.number().int().min(1).parse(page)),
      "page[size]": "100",
      redaction_enabled: "false",
    });
    return z
      .object({
        data: z.array(
          z.object({
            messaging_profile_id: z.literal(profileId),
            to: z.string().regex(/^\+[1-9]\d{6,14}$/),
            created_at: z
              .string()
              .transform((value) => new Date(value.replace(" ", "T")))
              .pipe(z.date()),
          }),
        ),
        meta: z.object({
          page_number: z.literal(page),
          total_pages: z.number().int().min(0),
        }),
      })
      .parse(await this.request(`/messaging_optouts?${query}`));
  }
  async search(country: string, phoneNumber?: string) {
    const query = new URLSearchParams({
      "filter[country_code]": country,
      "filter[features][]": "sms",
      "filter[limit]": "10",
    });
    query.set("filter[best_effort]", "false");
    if (phoneNumber) {
      const parsed = parsePhoneNumberFromString(phoneNumber);
      if (!parsed) return { data: [] };
      query.set("filter[phone_number][starts_with]", parsed.nationalNumber);
    }
    try {
      return availableNumbersSchema.parse(
        await this.request(`/available_phone_numbers?${query}`),
      );
    } catch (e) {
      if (
        e instanceof ProviderHttpError &&
        e.status === 400 &&
        e.codes.includes("10031")
      )
        return { data: [] };
      throw e;
    }
  }
  async provision(phoneNumber: string, profileId: string, reference: string) {
    return orderResponseSchema.parse(
      await this.request("/number_orders", "POST", {
        phone_numbers: [{ phone_number: phoneNumber }],
        messaging_profile_id: profileId,
        customer_reference: reference,
      }),
    ).data;
  }
  async order(id: string) {
    return orderResponseSchema.parse(
      await this.request(`/number_orders/${encodeURIComponent(id)}`),
    ).data;
  }
  async findOrder(reference: string) {
    const result = await this.request(
      `/number_orders?${new URLSearchParams({ "filter[customer_reference]": reference, "page[size]": "100" })}`,
    );
    return z
      .object({ data: z.array(orderSchema) })
      .parse(result)
      .data.find((o) => o.customer_reference === reference);
  }
  async findNumber(phone: string) {
    const result = await this.request(
      `/phone_numbers?${new URLSearchParams({ "filter[phone_number]": phone.replace(/\D/g, ""), "page[size]": "100" })}`,
    );
    return z
      .object({ data: z.array(ownedNumberSchema) })
      .parse(result)
      .data.find((n) => n.phone_number === phone);
  }
  async number(id: string) {
    return z
      .object({ data: ownedNumberSchema })
      .parse(await this.request(`/phone_numbers/${encodeURIComponent(id)}`))
      .data;
  }
  async messagingNumber(phone: string) {
    return z
      .object({
        data: z.object({
          messaging_profile_id: z.string().nullable(),
          phone_number: z.string(),
        }),
      })
      .parse(
        await this.request(
          `/messaging_phone_numbers/${encodeURIComponent(phone)}`,
        ),
      ).data;
  }
  async assignMessaging(phone: string, profileId: string) {
    return this.request(
      `/messaging_phone_numbers/${encodeURIComponent(phone)}`,
      "PATCH",
      { messaging_profile_id: profileId },
    );
  }
  async send(
    from: string,
    to: string,
    text: string,
    messagingProfileId: string,
    webhookUrl?: string,
  ) {
    const result = await this.request("/messages", "POST", {
      from,
      to,
      text,
      type: "SMS",
      messaging_profile_id: messagingProfileId,
      use_profile_webhooks: true,
      ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
    });
    return z
      .object({ data: z.object({ id: z.string().min(1) }) })
      .parse(result);
  }
  release(id: string) {
    return this.request(`/phone_numbers/${encodeURIComponent(id)}`, "DELETE");
  }
}
export { verifyTelnyxWebhook, type TelnyxEvent } from "./telnyx-webhooks";
