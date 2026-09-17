-- CreateTable
CREATE TABLE "BillingAccount" (
    "organizationId" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "status" TEXT NOT NULL DEFAULT 'free',
    "periodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodEnd" TIMESTAMP(3),
    "balanceMicros" BIGINT NOT NULL DEFAULT 0,
    "reservedMicros" BIGINT NOT NULL DEFAULT 0,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "autoTopup" BOOLEAN NOT NULL DEFAULT false,
    "autoTopupAmountCents" INTEGER NOT NULL DEFAULT 2500,
    "autoTopupThresholdCents" INTEGER NOT NULL DEFAULT 500,
    "autoTopupMonthlyLimitCents" INTEGER NOT NULL DEFAULT 10000,
    "paymentMethodId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingAccount_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "BillingLedger" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountMicros" BIGINT NOT NULL,
    "resourceId" TEXT,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingReservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "amountMicros" BIGINT NOT NULL,
    "settledMicros" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "occurredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingCheckout" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "selection" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "stripeSessionId" TEXT,
    "paymentIntentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhoneRental" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "phoneNumberId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paidUntil" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhoneRental_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEmailUsage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEmailUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsRate" (
    "prefix" TEXT NOT NULL,
    "maxProviderMicrosPerSegment" BIGINT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL,

    CONSTRAINT "SmsRate_pkey" PRIMARY KEY ("prefix")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_stripeCustomerId_key" ON "BillingAccount"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_stripeSubscriptionId_key" ON "BillingAccount"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingLedger_key_key" ON "BillingLedger"("key");

-- CreateIndex
CREATE INDEX "BillingLedger_organizationId_createdAt_idx" ON "BillingLedger"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingReservation_organizationId_status_idx" ON "BillingReservation"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCheckout_stripeSessionId_key" ON "BillingCheckout"("stripeSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCheckout_paymentIntentId_key" ON "BillingCheckout"("paymentIntentId");

-- CreateIndex
CREATE INDEX "BillingCheckout_organizationId_createdAt_idx" ON "BillingCheckout"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PhoneRental_phoneNumberId_key" ON "PhoneRental"("phoneNumberId");

-- CreateIndex
CREATE INDEX "PhoneRental_organizationId_status_idx" ON "PhoneRental"("organizationId", "status");

-- CreateIndex
CREATE INDEX "BillingEmailUsage_organizationId_period_idx" ON "BillingEmailUsage"("organizationId", "period");

-- AddForeignKey
ALTER TABLE "BillingAccount" ADD CONSTRAINT "BillingAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingLedger" ADD CONSTRAINT "BillingLedger_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "BillingAccount"("organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingReservation" ADD CONSTRAINT "BillingReservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "BillingAccount"("organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingCheckout" ADD CONSTRAINT "BillingCheckout_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "BillingAccount"("organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhoneRental" ADD CONSTRAINT "PhoneRental_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "BillingAccount"("organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEmailUsage" ADD CONSTRAINT "BillingEmailUsage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "BillingAccount"("organizationId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Enforce seat capacity under concurrency, including invitation acceptance.
CREATE FUNCTION papers_billing_member_limit() RETURNS trigger AS $$
DECLARE cap integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('billing:' || NEW."organizationId"));
 SELECT CASE WHEN status = 'active' AND "periodEnd" > now() THEN CASE plan WHEN 'scale' THEN 10 WHEN 'developer' THEN 2 ELSE 1 END ELSE 1 END
 INTO cap FROM "BillingAccount" WHERE "organizationId" = NEW."organizationId";
 IF cap IS NOT NULL AND (SELECT count(*) FROM "member" WHERE "organizationId"=NEW."organizationId") >= cap THEN
  RAISE EXCEPTION 'Workspace plan member limit reached' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER papers_billing_member_limit BEFORE INSERT ON "member" FOR EACH ROW EXECUTE FUNCTION papers_billing_member_limit();
