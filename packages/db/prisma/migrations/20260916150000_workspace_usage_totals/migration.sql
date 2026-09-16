-- Workspace counters previously excluded legacy agent-owned resources.
-- Include their existing usage before enforcing limits across the workspace.
INSERT INTO "WorkspaceEmailUsage" (id, "organizationId", day, sends, "smsSends")
SELECT gen_random_uuid()::text, a."organizationId", u.day, SUM(u.sends)::integer, SUM(u."smsSends")::integer
FROM "DailyUsage" u JOIN "Agent" a ON a.id = u."agentId"
GROUP BY a."organizationId", u.day
ON CONFLICT ("organizationId", day) DO UPDATE SET
  sends = "WorkspaceEmailUsage".sends + EXCLUDED.sends,
  "smsSends" = "WorkspaceEmailUsage"."smsSends" + EXCLUDED."smsSends";
