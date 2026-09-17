import { z } from "zod";
/** Public, non-secret billing catalog. All allowances belong to a workspace. */
export const plans = {
  free: {
    name: "Free",
    monthlyCents: 0,
    inboxes: 3,
    emails: 3000,
    storageGB: 3,
    domains: 0,
    seats: 1,
    numbers: 0,
  },
  developer: {
    name: "Developer",
    monthlyCents: 2000,
    inboxes: 10,
    emails: 10000,
    storageGB: 10,
    domains: 10,
    seats: 2,
    numbers: 3,
  },
  scale: {
    name: "Scale",
    monthlyCents: 20000,
    inboxes: 150,
    emails: 100000,
    storageGB: 100,
    domains: 150,
    seats: 10,
    numbers: 25,
  },
} as const;
export type PlanId = keyof typeof plans;
export const topupAmounts = [1000, 2500, 5000, 10000] as const;
export function planFor(value: string) {
  return plans[value as PlanId] ?? plans.free;
}

export const billingCheckoutInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("plan"), plan: z.enum(["developer", "scale"]) }),
  z.object({
    kind: z.literal("topup"),
    amountCents: z.union([
      z.literal(1000),
      z.literal(2500),
      z.literal(5000),
      z.literal(10000),
    ]),
  }),
  z.object({
    kind: z.literal("phone"),
    country: z.literal("US"),
    phoneNumber: z.string().regex(/^\+[1-9]\d{6,14}$/),
  }),
]);
export const autoTopupInput = z.object({
  autoTopup: z.boolean(),
  autoTopupAmountCents: z.number().int().min(1000).max(10000),
  autoTopupThresholdCents: z.number().int().min(200).max(10000),
  autoTopupMonthlyLimitCents: z.number().int().min(1000).max(100000),
});
export const changePlanInput = z.object({
  plan: z.enum(["developer", "scale"]),
});
