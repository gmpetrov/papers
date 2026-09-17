import { releaseNumber } from "./phone-numbers";
import type { Database } from "@agentinfra/db";
import type { Environment } from "./index";
import { TelnyxProvider } from "@agentinfra/providers";
import { effectivePlan } from "./billing-ledger";
import { stripeClient, refundFailedPhoneCheckout } from "./stripe-billing";
/** Provider control is deliberately separate from webhook acceptance. Never disable a shared profile. */
export async function reconcileBillingPhones(db: Database, env: Environment) {
  if (
    !env.STRIPE_SECRET_KEY ||
    !env.TELNYX_API_KEY ||
    env.TELNYX_STATUS !== "active"
  )
    return { processed: 0 };
  const provider = new TelnyxProvider(env.TELNYX_API_KEY, env.TELNYX_STATUS);
  const stripe = stripeClient(env);
  const rentals = await db.phoneRental.findMany({
    where: { phoneNumberId: { not: null } },
    take: 100,
  });
  let processed = 0;
  for (const rental of rentals) {
    const number = await db.phoneNumber.findUnique({
      where: { id: rental.phoneNumberId! },
    });
    if (!number) continue;
    if (
      number.status === "failed" &&
      (await refundFailedPhoneCheckout(db, stripe, rental.id))
    ) {
      processed++;
      continue;
    }
    if (["released", "failed"].includes(number.status)) {
      if (!rental.cancelAtPeriodEnd && rental.status !== "canceled") {
        await stripe.subscriptions.update(rental.id, {
          cancel_at_period_end: true,
        });
        await db.phoneRental.update({
          where: { id: rental.id },
          data: { cancelAtPeriodEnd: true },
        });
      }
      continue;
    }
    if (
      !number.providerId ||
      !["active", "billing_suspended"].includes(number.status)
    )
      continue;
    const a = await db.billingAccount.findUniqueOrThrow({
      where: { organizationId: rental.organizationId },
    });
    const paid =
      rental.status === "active" &&
      rental.paidUntil &&
      rental.paidUntil > new Date();
    if (
      !paid &&
      rental.paidUntil &&
      (rental.status === "canceled" ||
        Date.now() - rental.paidUntil.getTime() > 7 * 86400000)
    ) {
      await releaseNumber(
        db,
        env,
        {
          id: "billing-system",
          userId: "billing-system",
          organizationId: rental.organizationId,
          role: "owner",
          scopes: ["numbers:release"],
        },
        number.id,
        `billing-expired-${rental.id}`,
      );
      processed++;
      continue;
    }
    const enabled =
      paid &&
      !a.blocked &&
      effectivePlan(a).numbers > 0 &&
      a.balanceMicros - a.reservedMicros > 0n;
    if (!enabled && number.status === "active") {
      // Stop application sends before asking the provider to detach. Retrying a desired configuration is safe.
      await db.phoneNumber.update({
        where: { id: number.id },
        data: { status: "billing_suspended", lastError: "billing_paused" },
      });
    }
    if (!enabled) {
      await provider.configureMessagingProfile(number.providerId, "");
      const saved = await provider.messagingNumber(number.phoneNumber);
      if (saved.messaging_profile_id)
        throw new Error("Messaging suspension not confirmed");
      processed++;
    } else if (number.status === "billing_suspended") {
      await provider.configureMessagingProfile(
        number.providerId,
        number.messagingProfileId,
      );
      const saved = await provider.messagingNumber(number.phoneNumber);
      if (saved.messaging_profile_id !== number.messagingProfileId)
        throw new Error("Messaging restoration not confirmed");
      await db.phoneNumber.update({
        where: { id: number.id },
        data: { status: "active", lastError: null },
      });
      processed++;
    }
  }
  return { processed };
}
