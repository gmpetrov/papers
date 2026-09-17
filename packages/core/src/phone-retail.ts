import { TelnyxProvider } from "@agentinfra/providers";
import type { Environment } from "./index";
import { assert } from "./errors";

type InventoryNumber = Awaited<
  ReturnType<TelnyxProvider["search"]>
>["data"][number];
export function standardNumber(country: string, quote: InventoryNumber) {
  return (
    country === "US" &&
    quote.phone_number_type === "local" &&
    quote.features.some((f) => f.name === "sms") &&
    quote.cost_information.currency === "USD" &&
    Number(quote.cost_information.monthly_cost) <= 1.1 &&
    Number(quote.cost_information.upfront_cost) <= 1.1
  );
}
export async function selectedNumberQuote(
  env: Environment,
  country: string,
  phoneNumber: string,
) {
  const results = await new TelnyxProvider(
    env.TELNYX_API_KEY,
    env.TELNYX_STATUS,
  ).search(country, phoneNumber);
  const quote = results.data.find((q) => q.phone_number === phoneNumber);
  assert(
    quote,
    409,
    "number_unavailable",
    "This number is no longer available. Choose another number.",
  );
  assert(
    standardNumber(country, quote),
    409,
    "quote_required",
    "This number is not available at the standard $3/month price.",
  );
  return {
    country,
    phoneNumber,
    monthlyCost: quote.cost_information.monthly_cost,
    upfrontCost: quote.cost_information.upfront_cost,
    currency: quote.cost_information.currency,
  };
}
export function retailNumber(quote: InventoryNumber) {
  return {
    phone_number: quote.phone_number,
    phone_number_type: quote.phone_number_type,
    features: quote.features,
    region_information: quote.region_information,
    cost_information: {
      upfront_cost: "0.00",
      monthly_cost: "3.00",
      currency: "USD",
    },
  };
}
export function retailAmount(micros: bigint) {
  return `${micros / 1000000n}.${(micros % 1000000n).toString().padStart(6, "0")}`;
}
