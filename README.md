# Papers

Email and phone infrastructure for agents. The implementation requirements live in [IMPLEMENTATION-BRIEF.md](IMPLEMENTATION-BRIEF.md). Credit cards are deferred.

Start with the [agent connection quickstart](docs/agent-quickstart.md) for REST, MCP, SDK, and CLI setup.

## Local development

Use Node.js 22 and pnpm 10.32.1. Copy `.env.example` to `.env`, supply credentials, then run:

```sh
pnpm install
docker compose up -d
pnpm db:generate
pnpm db:migrate
pnpm dev
```

Install `uv` for Python SDK tasks. `pnpm test` runs the TypeScript integration
suite and Python tests; `pnpm build` includes the Python wheel/source distribution
through Turborepo. Python dependencies are locked in `sdks/python/uv.lock`.

`pnpm dev` starts both Next.js and the background jobs process, which processes incoming mail and Stripe billing events. Next.js listens on port 3000; the existing development tunnel points `https://dev.chaindesk.ai` there. PostgreSQL runs locally on port 55433. Use `pnpm jobs` only when running the web app separately. Restart `pnpm dev` after editing `.env`; Turbo explicitly forwards the billing and provider variables listed in `turbo.json`.

Customer documentation lives in `apps/docs`. After API contract changes, run `pnpm docs:openapi` to regenerate its reference, then run `mint validate` and `mint broken-links` from `apps/docs`.

Run `mint dev --port 3001 --no-open` from `apps/docs` and open `http://localhost:3001` for a live local authoring preview. The local preview serves at `/` and cannot be mounted at `/docs` with rewrites alone because its navigation uses root-relative links.

To serve the deployed docs at `https://www.papers.bot/docs`:

1. In Mintlify's **Custom domain setup**, enable **Host at**, enter `www.papers.bot`, and set the base path to `docs`. Connect the documentation source to `apps/docs` and publish. See [Mintlify's subpath setup](https://www.mintlify.com/docs/deploy/reverse-proxy).
2. Verify that `https://papers.mintlify.site/docs` and a nested page work before deploying the web app. A 404 here means the Mintlify deployment is not ready; changing the proxy to target `/` will not fix navigation.
3. Push to `main` to run the Cloudflare Workers Build pipeline (`pnpm cf:build:web`, then `pnpm cf:deploy:web`). The deploy script requires the CI main-branch context and production database build secret. The build script defaults `MINTLIFY_DOCS_ORIGIN` to `https://papers.mintlify.site`. Next.js bakes rewrites into the build, so changing only Worker runtime variables is insufficient: rebuild after changing the origin.
4. Verify `/docs`, a nested page, assets, and `/docs/llms.txt` on `https://www.papers.bot`.

For the same deployed docs at `http://localhost:3000/docs`, set `MINTLIFY_DOCS_ORIGIN=https://papers.mintlify.site` in `.env` and restart `pnpm dev`. Leave it empty to retain the web app's built-in docs page. The proxy forwards `/docs/*`, Mintlify asset/API routes, and `/.well-known/vercel/*` for domain verification. The upstream base path must remain `/docs` so generated links stay under our domain's `/docs` path. Keep the existing `www` Worker custom domain/DNS record: the Mintlify CNAME option sends the entire host to Mintlify and is not used for this reverse-proxy setup.

Keep `.env` and `.dev.vars` local. Provider credentials belong only on the server. Google OAuth must allow the Better Auth callback at `/api/auth/callback/google` on the configured application origin. Resend webhooks use `/api/webhooks/resend`.

## Current implementation

- One Next.js app for the landing page, dashboard, authentication, REST API, and remote MCP endpoint.
- Better Auth with Google and password authentication, organizations, teams, invitations, basic roles, and the admin impersonation plugin.
- Workspace settings include member role changes, team membership controls, and invitation resends. Platform admins can find an account by exact email at `/support` and start a 15-minute impersonation session; organization owners do not receive platform admin access.
- Invitation recipients can review the workspace and role, accept or decline, and retry workspace selection after acceptance without accepting twice. Details require the matching verified account. `node scripts/invitation-browser-check.mjs` checks the UI with mocked auth responses; the organization integration tests verify recipient restrictions and expiry against PostgreSQL.
- Workspace-owned inbox provisioning, scoped workspace API keys, email sending/replies, read/unread controls, signed Resend webhook ingestion, background processing, and message viewing.
- Inbound email uses envelope-recipient routing with per-inbox deduplication; see [routing and discard behavior](docs/email-routing.md).
- Tenant authorization, idempotency records, send quotas, event records, and audit records.
- TypeScript and Python clients, CLI commands with browser OAuth login/refresh/logout and event watching, and shared remote/stdio MCP tools. See [CLI setup](docs/cli.md).
- Telnyx is active locally with a configured messaging profile and webhook verification key. Workspace-owned number search, priced purchase, release, order reconciliation, and two-way SMS are implemented; see [Telnyx setup and verification](docs/telnyx.md). Live search, configuration, and inbound SMS processing are verified; outbound recipient delivery remains unverified.

These are development foundations, not a production release. Google sign-in and returning login after sign-out have been verified interactively against the development tunnel; see [Google sign-in verification](docs/google-sign-in.md). Delegated OAuth with PKCE, workspace selection, consent, and revocation now works in browser and local Workers tests; see [OAuth setup and limits](docs/oauth.md). [Private attachment storage and downloads](docs/attachments.md) work in local R2, the dashboard, both SDKs, CLI, and MCP, including revocable 60-second links. [SMS recovery](docs/telnyx.md) handles saved provider acceptance and matching signed callbacks without resending; legacy unknown sends without evidence still require investigation. Individual third-party client compatibility, store listings, package publication, full administration screens and portions of production infrastructure remain incomplete. [Subscription billing and prepaid usage](docs/billing.md) now include Stripe Checkout, signed payment callbacks, a retained financial ledger, plan limits, and automatic top-ups; phone rental checkout starts after selecting a number, with automatic provisioning after payment and retail-only customer pricing. [Customer webhooks](docs/customer-webhooks.md) now include dashboard configuration, activation, signed retries, and delivery history; deployed Cloudflare egress verification remains outstanding. Cards are outside the initial release.

## Validation and deployment status

`pnpm typecheck` checks all TypeScript packages. `pnpm test` uses the separate local `agentinfra_test` database and provider mocks; create and migrate that database before running it. Tests cover tenant isolation, key revocation, concurrency, idempotency, quotas, and signed webhook routing.

`pnpm --filter @agentinfra/web build` builds Next.js. `pnpm --filter @agentinfra/web cf:build` creates the Cloudflare Workers bundle with OpenNext. Both builds have passed. `node scripts/workers-check.mjs` verifies PostgreSQL, password sign-in, sessions, organization selection, REST, organization API-key MCP (including paginated approvals), signed webhook ingress, and Google authorization URL generation against local Workers on port 3001. It requires `.env.e2e` and the test workspace created by the browser check. Google consent/callback completion has also passed in the development browser; deployed Google login still needs verification. Both web and jobs now use [Hyperdrive bindings](docs/database-runtime.md), and the [background Worker](docs/background-workers.md) supports Queues plus scheduled recovery. No production deployment has been performed; managed PostgreSQL, cache-disabled Hyperdrive, the production domain, and deployed configuration verification remain outstanding. The `papers` R2 bucket and `papers-jobs` queue have been created; see [deployment state](docs/deployment.md).

Prisma generates separate Node and Workers clients from the same schema. The web app uses the Workers client so its WebAssembly is statically bundled; local jobs and database tests use the Node client. Keep both output directories separate because Prisma regenerates them independently.

The Python SDK uses `uv sync`, `uv run pytest`, and `uv build` in `sdks/python`. See the [Python client guide](sdks/python/README.md) for sync/async examples, pagination, and error handling. GitHub Actions runs the database tests, type checks, SDK/CLI builds, Cloudflare web and jobs builds, and Python tests/build. CI also installs npm tarballs and the Python wheel in fresh directories, checking SDK imports, TypeScript declarations, the CLI executable, and stdio MCP. The workflow has been added but has not yet run on GitHub.

`scripts/browser-check.mjs` exercises the development tunnel using the ignored `.env.e2e` local fixture. `packages/auth/dev-fixture.ts` creates this fixture only against localhost databases. Never use the fixture against production.

See [client integration review materials](integrations/README.md) for ChatGPT, Claude, and Grok setup paths and outstanding publication requirements.

## Repository

- `apps/web`: Next.js landing page, dashboard, API, and MCP HTTP transport.
- `apps/mcp`: shared MCP server/tool definitions.
- `apps/jobs`: local durable event processor.
- `packages/auth`, `db`, `core`, `contracts`, `providers`: authentication, persistence, business logic, schemas, and provider adapters.
- `packages/sdk-typescript`, `packages/cli`, `sdks/python`: agent developer interfaces. Packages have not been published.

Request throttling and retry behavior: [API request limits](docs/request-limits.md).

Backup drill and deployment recovery procedure: [Recovery](docs/recovery.md).

Operator backlog checks: `pnpm jobs:status` ([documentation](docs/job-monitoring.md)).

Selected-resource API keys: [Resource grants](docs/resource-grants.md).
