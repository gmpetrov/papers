CREATE TABLE "ImpersonationAudit" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  CONSTRAINT "ImpersonationAudit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ImpersonationAudit_sessionId_key" ON "ImpersonationAudit"("sessionId");
CREATE INDEX "ImpersonationAudit_actorId_startedAt_idx" ON "ImpersonationAudit"("actorId", "startedAt");
CREATE INDEX "ImpersonationAudit_targetId_startedAt_idx" ON "ImpersonationAudit"("targetId", "startedAt");

-- Record access atomically with session creation/deletion, including sign-out
-- and revocation. No user/session foreign keys: deletion must retain history.
CREATE FUNCTION audit_impersonation_session() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."impersonatedBy" IS NOT NULL THEN
    INSERT INTO "ImpersonationAudit" (id, "sessionId", "actorId", "targetId", "startedAt", "expiresAt")
    VALUES (gen_random_uuid()::text, NEW.id, NEW."impersonatedBy", NEW."userId", NEW."createdAt", NEW."expiresAt");
  ELSIF TG_OP = 'DELETE' AND OLD."impersonatedBy" IS NOT NULL THEN
    UPDATE "ImpersonationAudit"
    SET "endedAt" = LEAST(clock_timestamp(), "expiresAt")
    WHERE "sessionId" = OLD.id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER audit_impersonation_session
AFTER INSERT OR DELETE ON session
FOR EACH ROW EXECUTE FUNCTION audit_impersonation_session();

-- Preserve any sessions already active when the migration is applied.
INSERT INTO "ImpersonationAudit" (id, "sessionId", "actorId", "targetId", "startedAt", "expiresAt")
SELECT gen_random_uuid()::text, id, "impersonatedBy", "userId", "createdAt", "expiresAt"
FROM session WHERE "impersonatedBy" IS NOT NULL;
