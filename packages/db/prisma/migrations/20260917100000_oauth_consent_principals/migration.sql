-- Preserve history/idempotency for current connections; revoked connections
-- cannot transfer their historical authority to a later consent for the client.
UPDATE "Operation" o SET "principalId" = 'oauth:' || c.id
FROM "oauthConsent" c
WHERE o."organizationId" = c."referenceId"
  AND o."principalId" = 'oauth:' || c."clientId" || ':' || c."userId" || ':' || c."referenceId";
UPDATE "Approval" a SET "principalId" = 'oauth:' || c.id
FROM "oauthConsent" c
WHERE a."organizationId" = c."referenceId"
  AND a."principalId" = 'oauth:' || c."clientId" || ':' || c."userId" || ':' || c."referenceId";
