-- Defer the invariant so Better Auth can remove memberships and then the
-- organization in one transaction, and ownership can be transferred atomically.
CREATE FUNCTION preserve_workspace_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.role <> 'owner' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.role = 'owner' AND NEW."organizationId" = OLD."organizationId" THEN
      RETURN NULL;
    END IF;
  END IF;

  -- Serialize owner losses on the parent. A write (rather than only a row
  -- lock) also causes stale REPEATABLE READ transactions to abort safely.
  -- The non-key column avoids conflicting with foreign-key key-share locks.
  UPDATE organization SET name = name WHERE id = OLD."organizationId";
  IF NOT FOUND THEN
    RETURN NULL; -- The workspace itself was intentionally deleted.
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM member
    WHERE "organizationId" = OLD."organizationId" AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'A workspace must retain at least one owner'
      USING ERRCODE = '23514', CONSTRAINT = 'workspace_requires_owner';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER workspace_requires_owner
AFTER UPDATE OR DELETE ON member
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION preserve_workspace_owner();
