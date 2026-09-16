CREATE TABLE "WebhookDelivery" (
  "id" TEXT PRIMARY KEY,
  "endpointId" TEXT NOT NULL REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE,
  "eventId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "lastStatusCode" INTEGER,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "WebhookDelivery_endpointId_eventId_key" ON "WebhookDelivery"("endpointId", "eventId");
CREATE INDEX "WebhookDelivery_status_availableAt_idx" ON "WebhookDelivery"("status", "availableAt");
CREATE TABLE "WebhookDeliveryAttempt" (
  "id" TEXT PRIMARY KEY,
  "deliveryId" TEXT NOT NULL REFERENCES "WebhookDelivery"("id") ON DELETE CASCADE,
  "attempt" INTEGER NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "statusCode" INTEGER,
  "error" TEXT
);
CREATE UNIQUE INDEX "WebhookDeliveryAttempt_deliveryId_attempt_key" ON "WebhookDeliveryAttempt"("deliveryId", "attempt");
-- Outbox creation shares the event transaction, including events from old clients.
-- Snapshot subscriptions and payload once. No historical replay on enablement.
CREATE FUNCTION papers_enqueue_webhook() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "WebhookDelivery" ("id", "endpointId", "eventId", "url", "body")
  SELECT gen_random_uuid()::text, e."id", NEW."id", e."url",
    jsonb_build_object('id', NEW."id", 'type', NEW."type", 'resourceId', NEW."resourceId",
      'createdAt', to_char(NEW."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'contentTrust', 'untrusted')::text
  FROM "WebhookEndpoint" e
  WHERE e."organizationId" = NEW."organizationId" AND e."enabled"
    AND NEW."type" = ANY(e."eventTypes");
  RETURN NEW;
END;
$$;
CREATE TRIGGER papers_event_webhook AFTER INSERT ON "Event"
  FOR EACH ROW EXECUTE FUNCTION papers_enqueue_webhook();
