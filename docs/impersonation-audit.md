# Support impersonation history

Platform administrators can impersonate users through Better Auth for up to
15 minutes. Workspace ownership does not grant this permission.

`ImpersonationAudit` records the support administrator ID, target user ID,
session ID, start time, expiry, and early termination time. It contains no
session token, cookies, IP address, or message contents. It has no cascading
foreign keys, so deleting a session or account preserves the audit record.

A PostgreSQL trigger writes the start record atomically with session creation.
If the audit write fails, session creation fails too. Deleting an impersonation
session records its termination in the same transaction, whether deletion comes
from stopping impersonation, sign-out, revocation, or account deletion. This
records session termination, not the particular action that caused it.

Access ends at `endedAt` when present, otherwise at `expiresAt`. A null
`endedAt` does **not** mean access is still active: expired sessions may remain
in the database until cleanup. Cleanup after expiry records the expiry time as
the effective end, rather than implying that access continued until cleanup.
Better Auth's impersonation cookie normally suppresses session refresh. A
database trigger also prevents updates from extending the original expiry or
changing the audited identity. Shortening the expiry updates the audit record.

The migration backfills impersonation sessions still present at deployment.
It cannot reconstruct previously deleted sessions. Normal sign-ins and denied
impersonation attempts do not create access records.

This is currently an internal database audit, not a customer-facing endpoint.
Only operators with database access can query it. Tests exercise actual
Better Auth start/stop requests, rejected workspace-owner access, the 15-minute
expiry, and history retention through deletion of an expired target account.
