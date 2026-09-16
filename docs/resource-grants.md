# Selected-resource access

Migration 26 adds optional `resourceGrants` when an owner/admin creates an API key
through `POST /v1/api-keys`. Scopes still control which actions are allowed; grants
limit the inboxes and phone numbers on which those actions can operate.

```json
{
  "name": "Support integration",
  "scopes": ["inboxes:read", "email:send", "numbers:read", "sms:read", "sms:send", "events:read"],
  "resourceGrants": {
    "inboxIds": ["YOUR_INBOX_ID"],
    "phoneNumberIds": ["YOUR_PHONE_NUMBER_ID"]
  }
}
```

IDs must already belong to the current workspace and, for a legacy agent-linked
key, to that agent. Each list supports at most 100 IDs; duplicates are normalized.
Omitting grants or using `null` preserves workspace-wide resource access within
the key's scopes. An explicit empty object/list grants no access of that kind.
Existing keys remain unchanged. `/v1/me` reports the effective grant selection.

Lists, pagination cursors, message reads/replies, SMS, attachment downloads and
signed attachment URLs enforce the same selection. The event feed contains only
events for selected resources or their messages. Operations and approval requests
retain their existing principal isolation. Requests outside the selection return
not found, so they cannot disclose another resource's contents. Invalid stored
grant data fails authentication instead of falling back to unrestricted access.

A selected-resource key cannot create inboxes or purchase new numbers, even when
it has write/provision scopes. It can archive/reactivate a selected inbox or release
a selected number when its scopes and workspace policy permit. Legacy agent
management is unavailable through selected-resource keys. Other workspace/human
administration continues to require the appropriate dashboard session.

Grant selections are immutable through the public API: create a replacement key
and revoke the old key when changing delegated access. This avoids old approvals
or operations silently inheriting a different grant selection. The API-key creation dialog now includes a resource picker with paginated inbox
and phone-number lists, empty/error states, and a 100-selection limit per kind.
Selected mode hides creation quotas and only offers number release permission.
Key rows show the selection counts.

The key dialog defaults to read-only scopes and offers an explicit write preset.
The overview onboarding shortcut starts with inbox-only read permission and the
active inbox selected. Browser checks verified that choosing write permissions
reveals limits and phone-management controls; no credential was created during
that UI check. Existing keys retain their original permissions.

OAuth consent also supports selected inboxes and phone numbers (migration 27).
The selection is stored with consent before issuing the authorization code and
enforced by the same resource checks as API keys. Refresh preserves the selection.
The consent picker lists resources from the workspace displayed in the consent
form, after checking current membership. Changing the dashboard's active workspace
does not change an existing connection's access.

To change a connection's selection, revoke it and connect again. Repeated consent
cannot expand or replace an existing selection. Operations and approvals are bound
to the consent record (migration 28), so a new connection cannot inherit an old
connection's operations or approvals. Consent deletion revokes access and refresh
tokens and removes pending authorization codes (migrations 29–30), including when
deletion occurs through Better Auth's endpoint.

Isolated OAuth tests verify selected-resource reads, foreign-resource rejection,
refresh preservation, rejected expansion, and that reconnecting does not restore
old tokens, pending codes, or operation access. The rebuilt local Worker also passed resource-picker session/workspace isolation,
empty-selection consent persistence and MCP enforcement, and revocation checks.
Interactive browser verification of the OAuth resource picker passed on September
16 against the development tunnel: the archived inbox loaded, selecting it changed
the count to one, the empty phone-number state appeared, and selected mode cleared
and disabled number provisioning. Returning to workspace mode enabled the
permission without silently selecting it. This was a consent-page preview using
an existing public client ID; no authorization was submitted or token issued.
Signed authorization, consent submission and token enforcement are covered by
the separate database and local Worker protocol checks.

The grants run in the shared API used by SDKs, CLI and MCP. Core tests cover
within-workspace and cross-workspace denial, resource/event pagination, sends and
replies, attachments including signed URL redemption, no-resource selections,
malformed stored grants, and owner-only selection validation. The OpenNext build and local workerd checks passed through migration 30. The
Worker test verifies grant discovery, empty-selection resource/event lists, zero
provisioning allowance, and creation denial; it also checks a selected inbox when
the existing runtime fixture has one. Temporary test keys are revoked afterward.
Production verification remains outstanding.

Dashboard verification on September 16, 2026 covered switching access modes,
selecting the archived fixture inbox, the no-phone-number state, selection counts,
and restoring creation fields when switching back to workspace access. No key was
created through the browser; authenticated API creation and enforcement are covered
by isolated database tests. The web package type check passed.
