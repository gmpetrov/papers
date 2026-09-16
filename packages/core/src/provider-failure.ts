import { ZodError } from "zod";
import { ProviderHttpError } from "@agentinfra/providers";
import type { SmsFailure } from "@agentinfra/contracts";

/** Persist structured diagnostics, never exception messages or provider response bodies. */
export function smsFailure(
  error: unknown,
  responseAccepted: boolean,
): SmsFailure {
  if (responseAccepted)
    return { kind: "confirmation_failed", providerCodes: [] };
  if (error instanceof ProviderHttpError)
    return {
      kind: "provider_http_error",
      httpStatus: error.status,
      providerCodes: [
        ...new Set(error.codes.filter((code) => /^\d{3,10}$/.test(code))),
      ].slice(0, 10),
    };
  return {
    kind:
      error instanceof ZodError
        ? "invalid_provider_response"
        : error instanceof Error && error.name === "TimeoutError"
          ? "timeout"
          : error instanceof TypeError
            ? "connection_error"
            : "unexpected_error",
    providerCodes: [],
  };
}
