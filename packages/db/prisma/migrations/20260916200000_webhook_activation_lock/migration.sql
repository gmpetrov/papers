-- Serialize subscription snapshots with endpoint activation/configuration updates.
CREATE OR REPLACE FUNCTION papers_enqueue_webhook() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "WebhookDelivery" ("id", "endpointId", "eventId", "url", "body")
  SELECT gen_random_uuid()::text, e."id", NEW."id", e."url",
    jsonb_build_object('id', NEW."id", 'type', NEW."type", 'resourceId', NEW."resourceId",
      'createdAt', to_char(NEW."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'contentTrust', 'untrusted')::text
  FROM "WebhookEndpoint" e
  WHERE e."organizationId" = NEW."organizationId" AND e."enabled"
    AND NEW."type" = ANY(e."eventTypes")
  FOR SHARE OF e;
  RETURN NEW;
END;
$$;
