# CLI development quickstart

Build from the repository with `pnpm --filter @agentinfra/cli build`. Packages are not yet published. Set `PAPERS_API_KEY` to a scoped workspace API key and optionally `PAPERS_BASE_URL` to the API origin. Provider secrets are never CLI credentials.

```sh
node packages/cli/dist/index.js whoami
node packages/cli/dist/index.js capabilities
node packages/cli/dist/index.js inboxes create --username research
node packages/cli/dist/index.js operations get OPERATION_ID
node packages/cli/dist/index.js operations wait OPERATION_ID --timeout 120 --interval 2
node packages/cli/dist/index.js events watch --interval 2
node packages/cli/dist/index.js events watch --cursor LAST_EVENT_ID
```

Operation waiting performs only reads. It continues polling pending and unknown outcomes, returns the final operation as JSON, and exits with status 1 on failed operations or timeout. Do not use a new send idempotency key to resolve an unknown outcome.

Event watching writes one JSON object per line: `{ "event": { ... }, "cursor": "EVENT_ID" }`. Persist the cursor after successfully handling an event and pass it on restart. Empty polls retain the previous cursor. Without a cursor, watching starts from the earliest retained event. Ctrl-C stops the stream and cancels the current HTTP request. HTTP failures stop the command with a structured error; restart from the last persisted cursor after resolving the error.

`node scripts/cli-polling-check.mjs` checks the built CLI against a local HTTP fixture. Browser login is available:

```sh
node packages/cli/dist/index.js login
node packages/cli/dist/index.js login --no-browser --scope "inboxes:read events:read offline_access"
node packages/cli/dist/index.js logout
```

Login opens the workspace consent flow with PKCE and a localhost callback. `--no-browser` prints the URL for manual opening. Credentials are stored per API origin in `~/.config/papers` with mode 0600; set `PAPERS_CONFIG_DIR` to override the directory. Requests refresh expired access tokens. `PAPERS_API_KEY`, when set, takes precedence over saved OAuth credentials. Logout revokes the saved refresh/access tokens and removes the local file; it does not revoke an environment API key. `logout --local-only` removes the file when the server is unreachable, leaving remote access to be revoked from Dashboard → Integrations.

Access remains subject to the issuing browser session and current workspace membership. Revoking or ending that session may require a new CLI login. The stored token uses the `/v1` audience; the local `papers mcp` adapter calls the REST API with that token, while a direct remote MCP connection obtains its own `/mcp` grant.

Saved-credential access is coordinated across CLI processes with an origin-specific lock. Each process rereads credentials after acquiring it, so concurrent commands do not refresh the same token twice. Logout holds the same lock through revocation and local deletion, preventing an in-flight refresh from restoring credentials afterward. Login takes the lock when saving its new credentials.

Lock waiting is cancellable for token requests and times out after 45 seconds with a retry message. The lock heartbeat runs every 10 seconds; an abandoned lock becomes recoverable after 60 seconds. Do not manually remove a lock held by a running process. Locking uses [proper-lockfile](https://github.com/moxystudio/node-proper-lockfile). The tests use separate Node processes and a local OAuth fixture to verify refresh/refresh and refresh/logout races, cancellation, and stale-lock recovery.

`scripts/cli-login-check.mjs` verifies browser consent, CLI access, token refresh, and remote logout against the development tunnel using the local test account.

Download email attachments with a credential granting `inboxes:read`:

```sh
node packages/cli/dist/index.js messages get MESSAGE_ID
node packages/cli/dist/index.js attachments download ATTACHMENT_ID --output ./invoice.pdf --max-bytes 5242880
```

Message details include attachment IDs and storage readiness. The download
command requires an explicit destination and refuses existing files, including
symlinks. It creates the file with mode 0600 and prints JSON containing its
absolute path and byte count. Provider filenames never select a local path.
Downloads are buffered before writing, so network failures or size-limit errors
do not create a destination file. The default and maximum limit is 25 MiB; zero
permits only empty files. Missing parent directories must be created separately.
Pending attachments return a structured error; the command does not retry.

## Installed-package verification

After building both `@papers.bot/sdk` and `@agentinfra/cli`, run
`pnpm exec node scripts/package-install-check.mjs` from the repository root.
It packs and installs both npm artifacts in a temporary directory, checks the
installed CLI executable, typechecks against the installed declarations, and
runs the installed SDK and stdio MCP against a local fixture. It removes the
temporary directory afterward. This requires registry access to install runtime
dependencies; it does not publish a package or contact Resend/Telnyx.

`python3 scripts/python-package-check.py` similarly installs the built Python
wheel into an isolated environment and exercises sync/async pagination. Build
the wheel first with `uv build --directory sdks/python`. Both package checks
are included in CI, which has not yet run on GitHub.
