# Workspace ownership

Workspace roles are `owner`, `admin`, and `member`. Only owners can grant or
change ownership. Better Auth rejects ordinary attempts to remove, demote, or
leave as the last owner. Platform administrators are separate from workspace
owners.

Migration `20260916140000_preserve_workspace_owner` also protects owner loss
at the database level. This closes the race where two requests each see another
owner before removing or demoting different memberships. The constraint checks
the final transaction state and serializes competing changes through a write to
the organization row. Under repeatable-read isolation, a stale competing write
aborts instead of approving a decision from an old snapshot.

The constraint is deferred so an atomic transfer can demote the former owner
before promoting the successor. It permits membership deletion when the
organization itself is deleted in the same transaction. Better Auth's Prisma
adapter therefore enables transactions; do not disable this setting. Its
organization deletion implementation removes memberships before the parent.

This constraint prevents losing an existing owner; organization creation still
relies on Better Auth to create its initial owner. Apply the migration in every
environment alongside the authentication configuration change. Existing
ownerless organizations are not repaired by this migration.

The organization tests use two open database transactions and a barrier to
force both membership changes before either commits. They cover simultaneous
demotions, removals, mixed changes, repeatable-read isolation, atomic transfer,
and organization deletion through the real authentication endpoint.

PostgreSQL references: [constraint triggers](https://www.postgresql.org/docs/current/sql-createtrigger.html)
and [transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html).
