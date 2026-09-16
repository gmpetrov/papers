-- Keep the audited identity and original expiry authoritative even if a
-- refresh request arrives without Better Auth's don't-remember cookie.
CREATE FUNCTION bound_impersonation_session() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."impersonatedBy" IS NOT NULL OR NEW."impersonatedBy" IS NOT NULL THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW."impersonatedBy" IS DISTINCT FROM OLD."impersonatedBy"
      OR NEW."userId" IS DISTINCT FROM OLD."userId" THEN
      RAISE EXCEPTION 'Impersonation session identity cannot change'
        USING ERRCODE = '23514';
    END IF;
    NEW."expiresAt" := LEAST(NEW."expiresAt", OLD."expiresAt");
    UPDATE "ImpersonationAudit" SET "expiresAt" = NEW."expiresAt"
    WHERE "sessionId" = OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bound_impersonation_session
BEFORE UPDATE ON session
FOR EACH ROW EXECUTE FUNCTION bound_impersonation_session();
