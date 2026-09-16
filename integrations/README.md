# Client integrations

Prepared September 16, 2026. These are setup and review materials, not published listings or evidence of third-party client compatibility.

| Client | Delivery path | Current evidence |
| --- | --- | --- |
| ChatGPT | Remote MCP plugin | Generic MCP/OAuth tests pass; actual ChatGPT connection and submission pending |
| Claude | Remote MCP connector | Generic MCP/OAuth tests pass; actual Claude connection and directory submission pending |
| Grok | Custom MCP connector; catalog route unresolved | Generic MCP/OAuth tests pass; actual Grok connection and catalog acceptance pending |

Development endpoint: `https://dev.chaindesk.ai/mcp`. Production endpoint has not been selected/deployed. OAuth resource audience must match the endpoint origin plus `/mcp`; `/v1` grants cannot be reused. Users select a Papers workspace during consent. Grant only the needed scopes, then review connection limits or revoke access under Dashboard → Integrations.

See the client-specific folders and [review scenarios](review-scenarios.md). No review account, legal/publisher identity, production support address, privacy policy, or terms have been fabricated. Fill those from the actual business before submission. Do not send developer credentials or the local test account to a review portal.

## Browser acceptance checkpoint — September 16, 2026

The available in-app browser was checked directly:

- ChatGPT has an authenticated session. Settings → Plugins links to Developer
  mode under Security and login. Developer mode is off; enabling it awaits
  the user's confirmation. No Papers connector has been created or authorized.
- Claude's connector settings redirected to its sign-in page.
- Grok's connectors page displayed Sign In and Get Started.

These observations explain the current acceptance-test blockers; they are not
evidence of successful client integration. Once account access is ready, use a
dedicated test workspace and start with identity and scoped resource-list reads.
Record discovered tools, OAuth consent behavior, results and revocation before
changing the compatibility status above. Do not test real sends or purchases as
part of an unapproved connection check.
