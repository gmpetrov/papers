# PostgreSQL through Hyperdrive

The web runtime and background Worker create their Prisma edge client using
`env.HYPERDRIVE.connectionString` inside the request or job invocation. Clients
are disconnected when that work finishes. The web app no longer reads a direct
`DATABASE_URL` to serve requests; that variable remains useful for migrations,
the local Node jobs process, and repository scripts.

Both Wrangler configurations currently contain an all-zero placeholder
Hyperdrive ID. The web app's local connection points to the development
`agentinfra` database; the standalone jobs Worker defaults to `agentinfra_test`.
Set `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` to override either
when running Wrangler. In production, both must reference a real Hyperdrive
configuration targeting the same migrated application database.

**Disable Hyperdrive query caching for the application connection.** Session,
permission, revocation, quota, and job-state reads must reflect current state.
Cloudflare enables query caching by default and does not invalidate cached reads
on writes. A cache-disabled configuration still provides connection pooling.
See [Hyperdrive query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/).

After a real Hyperdrive configuration exists, disable its caching with:

```sh
pnpm exec wrangler hyperdrive update HYPERDRIVE_ID --caching-disabled
```

The configuration ID is not a database credential. Store database access in
Hyperdrive; keep provider keys, Google credentials, and the Better Auth secret
as Worker secrets. Do not put credentials in deployment command arguments.

Local development uses Wrangler's direct database connection emulation. It
validates the application's binding-based code path, but does not prove real
Hyperdrive pooling or cache settings. Those require verification against the
provisioned Cloudflare configuration before release. See [local development](https://developers.cloudflare.com/hyperdrive/configuration/local-development/).

Changes to Wrangler bindings require restarting `pnpm dev` so OpenNext refreshes
its development bindings. Production PostgreSQL and Hyperdrive provisioning,
configuration verification, and deployment remain outstanding.
