# Delegated agent connections

The development MCP endpoint is `https://dev.chaindesk.ai/mcp`. Its protected-resource discovery document is `/.well-known/oauth-protected-resource/mcp`. Authorization-server metadata is served at `/.well-known/oauth-authorization-server/api/auth`; it points to Better Auth's registration, authorization, token, and revocation endpoints.

Better Auth 1.7.5 owns authorization codes, PKCE verification, signed authorization state, opaque access/refresh token issuance, rotation, and OAuth endpoint errors. The application uses a supported SHA-256 token storage transform and stores no plaintext access tokens. Access tokens last fifteen minutes. The resource server looks up the token and checks expiry, revocation, client/resource status, consent, current membership, and the issuing session before each request.

Clients request authorization-code flow with S256 PKCE and an explicit `resource` of either `https://dev.chaindesk.ai/mcp` or `https://dev.chaindesk.ai/v1`. A token for one audience cannot access the other. API keys remain available for the CLI and SDKs. Client-credentials grants are disabled.

The browser flow authenticates the human, asks for a workspace, and displays the application's requested permissions. The user may deselect permissions or deny consent. The consent submission carries the workspace currently displayed; the server validates membership and binds the resulting code/token to that workspace. It does not derive later API authorization from the dashboard's active workspace. OAuth cannot create API keys, elevate organization roles, or change agent policies. Member roles retain their existing restrictions.

Users revoke connections under Dashboard → Integrations in the relevant workspace. Revocation removes consent and revokes both access and refresh tokens for that user/client/workspace. Expired or ended login sessions also stop access under the current policy; renewable access does not bypass session expiry. Support impersonation cannot grant or revoke connections.

Consent can be limited to selected inboxes and phone numbers. The selection is
stored before code issuance, survives token refresh, and cannot be changed on an
existing connection. Revoke and reconnect to choose different resources. Pending
authorization codes are also removed when consent is deleted. Operations and
approvals belong to the specific consent record, so reconnecting cannot inherit
the previous connection's history or approvals. See [resource grants](resource-grants.md)
for enforcement rules and verification status.

Dynamic client registration is enabled for clients that use it. Public native clients must declare `application_type: native` for loopback callbacks. Web clients use HTTPS callbacks. Client ID Metadata Documents are not implemented yet, and this server has not been approved or listed in any client directory. The current transport uses the pinned official MCP SDK 1.30.0; newer protocol/profile compatibility and individual Claude, ChatGPT, and Grok acceptance remain release checks.

The integration tests exercise PKCE, code replay, scope/audience separation, refresh, revocation, membership removal, consent denial/tampering, and impersonation restrictions. `scripts/oauth-browser-check.mjs` exercises browser sign-in through consent, MCP execution, and dashboard revocation against the development tunnel. `scripts/workers-oauth-check.mjs` runs the protocol against the locally built Workers bundle on port 3001. Both use only the local development fixture; they never send external email or SMS.

Workspace owners/admins can set daily email/SMS caps for their own connections
under Integrations. Counters are attached to consent, not individual access
tokens, so refresh does not reset them. The agent cannot raise its limits.
See [send-limit behavior](workspace-limits.md).
