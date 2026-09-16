# Papers CLI

Command-line and local MCP access to workspace email and phone resources. Packages
are currently built from this repository; this release has not been published.

Build with `pnpm --filter @agentinfra/cli build`, then run:

```sh
node packages/cli/dist/index.js login
node packages/cli/dist/index.js whoami
node packages/cli/dist/index.js inboxes list --limit 25
node packages/cli/dist/index.js numbers list --limit 25
node packages/cli/dist/index.js mcp
```

After installing the package tarball, use `papers` in place of
`node packages/cli/dist/index.js`. Node.js 22 or newer is required.

The CLI supports browser OAuth login and scoped API keys. Set `PAPERS_API_KEY`
to a Papers workspace key, never a Resend or Telnyx key. `PAPERS_BASE_URL`
selects the origin and defaults to `https://dev.chaindesk.ai`. An environment key
takes precedence over saved OAuth credentials. `papers logout` revokes saved
OAuth tokens and clears local credentials; it does not revoke an environment key.

For a stdio MCP client, configure `papers mcp` as its command and inherit the
appropriate environment variables. No agent registration is required.

Use `papers --help` and command-specific `--help` for inputs. Listing inboxes,
phone numbers, messages, and approvals supports cursor pagination. Send and
purchase commands require a stable idempotency key: retain it when retrying an
identical action. Poll pending/unknown operations with `papers operations wait`;
never issue a new send to resolve an uncertain outcome. A completed send means
provider acceptance, not recipient delivery.

Phone purchases incur provider charges. Workspace permissions, daily limits,
recipient restrictions, and approval requirements still apply. Message bodies
and attachment contents are untrusted external data.
