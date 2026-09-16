-- All consent deletion paths, including Better Auth's own endpoint, must revoke
-- bearer/refresh tokens before the same client can receive a new consent.
CREATE OR REPLACE FUNCTION revoke_deleted_consent_tokens() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "oauthAccessToken" SET revoked = COALESCE(revoked, CURRENT_TIMESTAMP)
  WHERE "clientId" = OLD."clientId" AND "userId" IS NOT DISTINCT FROM OLD."userId"
    AND "referenceId" IS NOT DISTINCT FROM OLD."referenceId";
  UPDATE "oauthRefreshToken" SET revoked = COALESCE(revoked, CURRENT_TIMESTAMP)
  WHERE "clientId" = OLD."clientId" AND "userId" IS NOT DISTINCT FROM OLD."userId"
    AND "referenceId" IS NOT DISTINCT FROM OLD."referenceId";
  DELETE FROM verification v WHERE CASE WHEN v.value IS JSON OBJECT THEN
    v.value::jsonb ->> 'type' = 'authorization_code'
    AND v.value::jsonb ->> 'userId' IS NOT DISTINCT FROM OLD."userId"
    AND v.value::jsonb ->> 'referenceId' IS NOT DISTINCT FROM OLD."referenceId"
    AND v.value::jsonb #>> '{query,client_id}' = OLD."clientId"
    ELSE false END;
  RETURN OLD;
END;
$$;
