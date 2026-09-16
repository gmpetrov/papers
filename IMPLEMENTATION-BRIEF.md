# Implementation brief: infrastructure for AI agents

**Product correction (September 16, 2026):** There is no Agents dashboard section. Inboxes and API keys are workspace-owned and can be created without an agent. External agents connect through scoped credentials, MCP, SDKs or the CLI. Keep existing agent-linked records only for backward compatibility and preserve their restrictions. Phone resources should follow the same workspace ownership model when provisioning is implemented.

Status: implementation-ready proposed scope, with explicit product assumptions. Read PROVIDER-RESEARCH.md alongside this brief. Product name, incorporation country and launch markets are not yet specified. Use `Agent Infra` and `agentinfra` only as internal placeholders; package names are not verified or reserved.

## Product

Build a multi-tenant SaaS that gives AI agents dedicated email inboxes and phone numbers through one account and one consistent developer interface.

A human or business owns the account, configures permissions and budgets, and delegates access to agents. An agent is a software identity acting for its owner.

The core promise is: **give an agent an inbox and a phone number in minutes, then manage everything through MCP, an API, a Python SDK, a TypeScript SDK or a CLI.** Phone activation may require provider onboarding; expose that honestly rather than promising instant activation everywhere.

Assumed initial audience: developers and businesses operating agents. The first release includes email through Resend and phone numbers with two-way SMS through Telnyx. Credit/payment cards are deferred entirely, including sandbox implementation. Voice is a later feature unless confirmed as launch scope. Build actual durable infrastructure; core actions must work without an LLM.

## Required stack

- pnpm workspace and Turborepo.
- Next.js App Router, TypeScript, React; landing page and dashboard both in `apps/web`.
- Cloudflare Workers for hosting compute; R2 for attachments; Queues for asynchronous work.
- Prisma and managed PostgreSQL, connected from Workers through Hyperdrive and a supported driver adapter.
- Better Auth with Google sign-in, its Prisma adapter, Organization plugin with teams enabled, and Admin plugin for user impersonation. Use the matching React client plugins.
- Zod for shared runtime validation and public contracts; react-hook-form with Zod for forms.
- Vercel AI SDK only for optional summarization, classification or drafting. Using this library does not imply Vercel hosting.
- Resend for email and Telnyx for phone numbers/SMS. These are the selected first-release providers.

Use a PostgreSQL provider selected for deployment region, backups, point-in-time recovery and connection support. Neon is a candidate, not a finalized procurement decision. Better Auth is the selected authentication system; verify its Prisma adapter and enabled plugins on Workers. Do not implement cryptographic primitives or an OAuth authorization server from scratch.

## Repository

```text
apps/
  web/                     # Next.js landing, dashboard, docs, account flows
  api/                     # Worker: public REST API and provider webhooks
  mcp/                     # Worker: remote MCP transport and OAuth enforcement
  jobs/                    # Worker: queue consumers and scheduled reconciliation
packages/
  contracts/               # Zod schemas, API DTOs, OpenAPI generation
  core/                    # Domain services and policy enforcement
  db/                      # Prisma schema, migrations, repositories
  providers/               # Resend and Telnyx adapters + test fixtures
  auth/                    # Better Auth config/client, organizations, teams, RBAC, impersonation
  sdk-typescript/           # Published npm client
  cli/                     # Published npm executable using TypeScript SDK
  ui/                      # Shared UI components
  config/                  # Shared lint and TypeScript configuration
sdks/
  python/                  # Python package: pyproject.toml, typed sync/async client
integrations/
  claude/                  # Setup guide, connector metadata and review assets
  chatgpt/                 # Plugin package and review assets
  grok/                    # Custom MCP setup and catalog readiness materials
docs/                      # Architecture, operations, public contract, examples
```

Turborepo coordinates JS tasks and invokes Python tooling through explicit wrapper tasks. Use uv for Python dependency management and pytest for SDK verification. Never make server-only provider modules dependencies of public SDKs or browser bundles.

Use a small modular backend, not a fleet of microservices. REST and MCP call the same core domain services. The web app calls the backend through authenticated server-side requests or an explicitly secured browser flow. It must not bypass the policy layer with ad hoc database mutations.

Keep Next.js source APIs intact. First validate the current Cloudflare deployment adapter against SSR, route handlers, sessions, Prisma and streaming in a deployed preview. Cloudflare currently recommends vinext and also documents OpenNext; select and pin the compatible path after the spike, documenting the decision.

## User experience

Public routes: home, product pages for email and phone numbers, pricing, docs and integrations. Pricing and marketing describe the available email/phone product. Cards may appear only as a future roadmap item.

Dashboard routes under `/dashboard`: overview, inboxes, numbers, approvals, API keys, webhooks, integrations, usage/billing and organization settings.

Organization settings include members, teams, pending invitations and role management. Provide an organization/team switcher, invitation acceptance page, and member invite/resend/cancel/remove flows. A platform-admin-only support view provides impersonation with a persistent banner and an explicit “Stop impersonating” action.

Onboarding: create organization → provision an inbox → issue a scoped workspace API key → show working integration instructions. Use progressive onboarding for phone numbers so unfinished verification does not block email.

Every resource displays workspace ownership, capability/status and recent activity. Every billable operation has a visible cost model. Provide accessible loading, empty, error, pending-verification and unavailable-country states. Forms use react-hook-form and Zod; server validation remains authoritative.

## Identity, delegation and policy

Use Better Auth for signup, Google sign-in, email/password login, logout, database sessions, email verification and password reset. Send account and invitation emails through Resend. Mount its auth handler under `/api/auth/*` in `apps/web`, with shared configuration in `packages/auth`. Backend session validation must use the same trusted auth authority; do not trust browser-supplied user or role headers. Validate trusted origins, cookies and the web-to-API session flow in the runtime spike.

Provide a “Continue with Google” button on signup and login using Better Auth's built-in `socialProviders.google` and `authClient.signIn.social({ provider: "google" })`. Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `BETTER_AUTH_URL` server-side; register `/api/auth/callback/google` on the exact local, staging and production origins in Google Cloud. Use only identity scopes (openid/email/profile). Preserve invitation context through the redirect and return new users to onboarding or existing users to their dashboard. Reference: [Better Auth Google provider](https://better-auth.com/docs/authentication/google).

Google sign-in authenticates the human account; it does not connect Gmail or grant agent access to a user's Google services. Use Better Auth's verified provider identity and account-linking rules, with explicit authenticated linking when needed; do not merge accounts using an unverified email. A mismatched Google account must not accept an invitation for another email. Handle canceled consent and callback errors with a retry option.

Enable the Organization plugin with teams. Users may join multiple organizations and multiple teams within an organization. Organizations own inboxes, phone numbers and API credentials; teams initially organize members and invitation destinations. Team selection alone does not grant resource access. Resources belong directly to an organization. Connecting an external agent does not require creating an agent record.

Use basic, fixed organization roles: `owner`, `admin` and `member`, replacing the earlier developer/viewer proposal. An owner manages ownership, billing, organization deletion and all organization settings. An admin manages teams, invitations, members and operational policies, but cannot grant ownership or change/remove owners. A member uses resources and agents within assigned permissions, without managing membership, organization settings or usage limits. Preserve at least one owner and enforce these application permissions server-side. Defer custom role builders and per-team roles.

Keep platform roles (`user`/`admin` in the Admin plugin) separate from organization roles. Being an organization owner or admin never grants platform administration or impersonation. Agent scopes and resource grants remain distinct from human membership roles.

Implement email invitations with an organization role and optional team assignment. Only authorized owners/admins may invite; validate the role they can grant and that the target team belongs to the organization. Support pending, accepted, rejected, canceled and expired states. Require an authenticated account with a verified matching email to accept; invitation acceptance must not be triggered by a GET/link preview. Handle existing members, resend and duplicate acceptance without duplicate memberships. Removing a member or changing their role must affect subsequent authorization decisions and invalidate dependent access as appropriate.

Use the Admin plugin's impersonation capability; a separate impersonation plugin is not required. Restrict it to explicitly provisioned platform admins, use a short session lifetime, and restore the original admin session on exit. Record the real administrator and effective user on audit events, including impersonation start/stop and actions taken. Impersonation must not grant more access than the target user's permissions. Block policy approvals, API-key creation and OAuth consent while impersonating; enforce these restrictions in backend policy, not just the UI.

Implementation references: [Better Auth Organization plugin](https://better-auth.com/docs/plugins/organization), [Admin plugin and impersonation](https://better-auth.com/docs/plugins/admin), [Prisma adapter](https://better-auth.com/docs/adapters/prisma). Pin a maintained, patched version and generate the schema for the selected plugins before creating Prisma migrations.

Offer scoped, expiring, revocable API keys; store only key hashes and safe display prefixes. Enforce organization, project, agent, resource and capability boundaries on every request. The caller cannot widen scope by submitting another organization ID.

Examples of scopes: `inboxes:read`, `inboxes:write`, `email:send`, `numbers:read`, `numbers:provision`, `sms:send`. Administrative policy changes require a separate human/admin permission; an agent cannot increase its own usage or cost limits.

Support policy decisions `allow`, `deny`, `requires_approval`. Approval records bind the exact action, parameters/hash, resource, requesting principal, expiry and policy version. Changed parameters require a new decision. Approved actions execute once with idempotency protection.

Provide per-credential and organization limits for resource creation, sends and communication costs. Check permissions and policy again at execution time. Human approval is performed in a trusted dashboard flow, not inferred from text inside an email or tool argument.

## Email

Create unique addresses on a service-controlled receiving subdomain; support custom verified domains later. An inbox is our database resource, not a provider account. Enforce unique normalized addresses and never reassign a deleted address to another tenant by default.

Process signed Resend webhooks, retrieve received content, store message metadata/body durably and attachments privately in R2. Verify recipient routing using provider-supported delivery recipient data; test BCC and multiple recipients before launch. Never share one tenant's message body with another through an ambiguous address match.

Support inbox create/list/get/archive, messages list/get, send/reply, unread status, attachment download and cursor-based pagination. Thread using Message-ID, In-Reply-To and References, with a documented fallback. Track send acceptance separately from delivery, bounce or complaint.

Unknown recipients are discarded or quarantined under an explicit retention policy. Sanitize rendered HTML, disable remote image loading by default and issue short-lived attachment download URLs only after authorization. Inbound text and files are untrusted content, including when returned to an agent.

## Phone numbers and SMS

Expose country and capability discovery, number search, provision, list, get and release. Provision only verified supported combinations of country, number type, inbound/outbound SMS and optionally voice. Represent verification and provisioning as asynchronous operations.

Support sending, receiving and listing SMS, provider status updates, opt-out state and cost/segment usage. Model numbers as E.164 strings. Persist provider references internally; clients use our stable IDs.

Require policy permission before a billable number order or outbound send. Explain recurring rental on provision and loss of access on release. Retain a tombstone and provider event mapping after release so delayed events cannot route to a new tenant.

Implement provider registration and consent requirements for enabled markets. Do not promise reception of all OTP/short-code traffic. Voice interfaces can be reserved in the provider capability model, but do not expose nonfunctional call tools in the initial release.

## Public API

Serve versioned JSON REST endpoints under `/v1`. Proposed contract:

| Resource | Endpoints |
| --- | --- |
| Discovery | `GET /v1/capabilities`, `GET /v1/me` |
| Legacy agents (compatibility only) | Existing agent endpoints remain for older clients; no dashboard or onboarding dependency |
| Inboxes | `POST/GET /v1/inboxes`, `GET/PATCH /v1/inboxes/{id}` |
| Email | `GET/POST /v1/inboxes/{id}/messages`, `GET /v1/messages/{id}`, `POST /v1/messages/{id}/reply` |
| Numbers | `GET /v1/phone-numbers/available`, `POST/GET /v1/phone-numbers`, `GET/DELETE /v1/phone-numbers/{id}` |
| SMS | `POST/GET /v1/phone-numbers/{id}/messages` |
| Policies | Workspace limits; legacy agent policies remain enforced for existing resources |
| Approvals | `GET /v1/approvals`, `POST /v1/approvals/{id}/approve`, `POST /v1/approvals/{id}/deny` |
| Operations/events | `GET /v1/operations/{id}`, `GET /v1/events?after=...` |
| Webhooks | `POST/GET /v1/webhook-endpoints`, `PATCH/DELETE /v1/webhook-endpoints/{id}` |

Mutations with external effects require `Idempotency-Key`. Scope it to principal/tenant and operation; reject a reused key with different parameters. Use stable internal IDs, cursor pagination, ISO timestamps, request IDs, documented rate limits and `Retry-After`.

Asynchronous actions return `202` with an operation ID and status URL. Return stable machine-readable errors with `code`, `message`, `request_id`, `retryable`, and optional `details`. Include explicit `approval_required`, `verification_required`, `unsupported_country` and `provider_unavailable` cases.

Generate OpenAPI from public Zod contracts, not database models. Publish complete cURL examples, a sandbox quickstart and `/llms.txt`. Capability discovery describes available countries/features and onboarding requirements for this account.

## MCP, SDKs and CLI

Host a remote MCP server over HTTPS with Streamable HTTP, using the current protocol and official SDK. Use delegated OAuth with PKCE, resource/audience validation, revocation and minimum scopes. Adopt a maintained OAuth implementation and test against each target client's discovery requirements. Never pass platform API keys to upstream providers.

Better Auth owns human identity and organization membership. The Organization and Admin plugins alone do not satisfy the MCP OAuth authorization-server requirements; validate a compatible maintained OAuth provider integration against the chosen Better Auth version. Bind each grant to an explicit organization and scope, and recheck membership on access instead of relying on the user's currently selected dashboard organization.

Expose a small, clear tool set: `get_capabilities`, `create_inbox`, `list_messages`, `get_message`, `send_email`, `reply_to_email`, `search_phone_numbers`, `provision_phone_number`, `send_sms`, `list_sms`, `get_operation`, `list_approvals`. Include typed input/output schemas and accurate read/write, destructive and open-world annotations. Return structured results and safe explanatory text.

Tools obey the same authorization, policy and idempotency rules as REST. Annotate costly and external actions truthfully. Do not invent a generic `execute` tool. Keep untrusted message content separate from trusted tool instructions. OAuth consent grants access; it does not automatically authorize every future billable action.

Ship TypeScript and Python clients with matching resource names, typed responses, typed errors, pagination helpers, configurable timeout, sandbox selection and webhook verification helpers. Python supports sync and async. Retry only safe requests or mutations protected by a stable idempotency key; honor provider-facing operation state after ambiguous failures.

Publish an npm CLI using the TypeScript SDK: `login`, `logout`, `whoami`, `inboxes create/list`, `messages list/send`, `numbers search/create`, `sms send/list`, `events watch`, and `mcp` for a local stdio adapter. Provide JSON output, stable exit codes, noninteractive mode and useful help. Use secure credential storage when available; never print secrets by default. The stdio adapter delegates to our service and adds no separate business logic.

The onboarding page generates copyable per-client setup instructions with placeholders or scoped credentials. Publish examples for Claude, ChatGPT, Grok, a generic MCP client, Python, TypeScript and cURL. Add an agent skill/usage guide explaining permissions, waiting for events and approval handling.

## Events and reliability

Provider webhook ingress verifies the raw-body signature before processing, enforces timestamp/replay controls supported by that provider, and durably records the event before acknowledgement. Deduplicate by provider/account/event ID. Use an outbox transaction and retrying dispatcher to avoid a database-write/queue-publish gap.

Consumers are idempotent and tolerate reordered events. Use bounded backoff, dead-letter queues, replay tooling and scheduled reconciliation. Provider timeout after a send/order is ambiguous: reconcile with provider references or supported idempotency rather than blindly repeating the action.

Customer webhooks include event ID, timestamp, type, resource ID and schema version; sign deliveries with rotating secrets, retry with backoff and expose delivery logs. Validate callback URLs against SSRF, including redirects and private addresses. Customer delivery is at-least-once, not exactly-once. Polling with event cursors works even when an agent cannot receive webhooks.

## Data model

Use the Better Auth-generated Prisma models for User, Session, Account, Verification, Organization, Member, Invitation, Team and TeamMember, including the Admin plugin's role and impersonation fields. These are the identity/membership source of truth; do not create a parallel Membership table. Keep Better Auth verification tokens separate from provider onboarding records.

Additional Prisma models should cover: Project, ApiKey, OAuthGrant, Inbox, EmailMessage, EmailThread, Attachment, PhoneNumber, SmsMessage, ProviderCustomer, ProviderVerification, UsagePolicy, Approval, Operation, ProviderEvent, OutboxEvent, WebhookEndpoint, WebhookDelivery, UsageRecord and AuditEvent.

Every tenant-owned row has an organization ID; enforce tenant boundaries in repositories and composite relationships where possible. Use unique provider references, address uniqueness and deduplication constraints. Keep operational/provider states separate from public normalized states. Audit sensitive reads, permission changes, external actions and approvals without logging credentials or full message bodies.

## Quality and rollout

1. **Runtime spike:** prove Next.js deployment, Better Auth Google sign-in, sessions and Prisma adapter, organization/team and impersonation plugins, PostgreSQL, signed webhook raw bodies, queue processing and MCP transport on actual Workers. Record exact compatible versions.
2. **Foundation:** monorepo, CI, Better Auth Google and email/password account flows, organizations, teams, invitations, fixed roles, admin impersonation, contracts, policy, audit, fake providers and sandbox credentials.
3. **Email vertical slice:** provision inbox, receive, read, send and reply through dashboard, REST, both SDKs, CLI and MCP. Release a usable email beta.
4. **Phone:** Telnyx integration, verification states, number rental lifecycle, inbound/outbound SMS and real usage reporting.
5. **Distribution:** test OAuth and tool flows in Claude, ChatGPT and Grok; assemble and submit directory packages where supported. Track submitted/approved/published independently. Grok catalog placement requires a confirmed external route.

Required acceptance tests: tenant A cannot access tenant B's resources; revoked keys and OAuth grants stop working; concurrent identical provisioning creates one resource; webhook replay has one effect; provider timeout does not duplicate a send; queue replay preserves state; an agent cannot approve its own policy escalation; concurrent sends/provisioning respect communication quotas; reconciliation handles delayed delivery events; credentials never appear in tool output or logs.

Google sign-in acceptance tests: first-time signup, returning login, secure linking to an existing account, canceled consent, invalid callbacks, and invitation acceptance with matching/mismatched Google identities. Verify redirects in local and deployed environments.

Authentication acceptance tests: invitation acceptance rejects mismatched/unverified email and expired/canceled invitations; a team invitation adds membership only in the intended organization/team; duplicate acceptance is harmless; members cannot elevate roles; organization admins cannot impersonate or assign ownership; the last owner cannot be removed; membership removal invalidates access even with an existing session/OAuth grant; impersonation logs both identities, blocks restricted actions, expires correctly and restores the original admin session on exit.

Verify SDK/CLI examples against the same deployed sandbox API. Test OAuth in real clients, not only an isolated protocol test. Deployment must include migrations as a controlled CI task, backup/restore verification, secret rotation, error monitoring and an operator replay/reconciliation guide.

A successful developer experience means a new user can connect an agent and perform the email happy path in under five minutes without reading provider documentation. Track this in a fresh-account usability test. Do not fake production readiness with hardcoded success states.

## Later roadmap: credit/payment cards

Cards are deferred until after the email and phone product ships and a separate card scope is approved. Do not build card adapters, migrations, endpoints, MCP tools, SDK methods, CLI commands, dashboard pages, funding flows or card-specific tests for this release. Platform subscription billing and communication usage metering remain in scope.

Retain provider research and design considerations in `CARD-ROADMAP.md` and `PROVIDER-RESEARCH.md` for future evaluation. Stripe Issuing is a research candidate, not a current integration dependency. The first-release definition of done has no card-program or card-provider approval dependency.

## Instructions to the implementation LLM

Implement in the milestone order above. Start with the runtime spike and a concise architecture decision record, then build the email vertical slice end to end. Use the requested stack and keep landing/dashboard together in `apps/web`. Make ordinary reversible engineering decisions independently, document assumptions, and ask only when a missing business decision prevents the relevant milestone. Continue email and phone development with test fixtures while provider onboarding is pending. Do not implement deferred card features, even in sandbox.
Do not claim universal OTP reception or a marketplace listing until verified. Keep policy decisions deterministic. Keep SDKs and integrations thin. Deliver runnable code, migrations, environment-variable documentation, fixtures, deployment instructions and meaningful passing tests with each milestone.
