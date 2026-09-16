-- All consent deletion paths, including Better Auth's own endpoint, must revoke
-- bearer/refresh tokens before the same client can receive a new consent.
CREATE FUNCTION revoke_deleted_consent_tokens() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "oauthAccessToken" SET revoked = COALESCE(revoked, CURRENT_TIMESTAMP)
  WHERE "clientId" = OLD."clientId" AND "userId" IS NOT DISTINCT FROM OLD."userId"
    AND "referenceId" IS NOT DISTINCT FROM OLD."referenceId";
  UPDATE "oauthRefreshToken" SET revoked = COALESCE(revoked, CURRENT_TIMESTAMP)
  WHERE "clientId" = OLD."clientId" AND "userId" IS NOT DISTINCT FROM OLD."userId"
    AND "referenceId" IS NOT DISTINCT FROM OLD."referenceId";
  RETURN OLD;
END;
$$;
CREATE TRIGGER oauth_consent_delete_revokes_tokens BEFORE DELETE ON "oauthConsent"
FOR EACH ROW EXECUTE FUNCTION revoke_deleted_consent_tokens();
