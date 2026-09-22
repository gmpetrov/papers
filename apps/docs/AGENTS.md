# Papers documentation

This Mintlify site documents the customer-facing Papers product at https://www.papers.bot/docs.

- Use workspace, inbox, phone number, API key, connection, operation, and approval consistently. No agent registration is needed for new integrations.
- Verify behavior against packages/contracts, packages/core, the SDKs, and the dashboard. Internal docs may describe older behavior or deployment history.
- Write short, direct sentences. Explain the action, required permission, result, and relevant failure behavior. Avoid promotional filler.
- Use production URLs in examples. Keep example credentials as placeholders and never include private configuration, customer data, provider secrets, or operational account IDs.
- Do not describe planned features as available. Custom domains, voice, and self-service MMS are not currently offered.
- Preserve idempotency keys across retries. Explain provider acceptance separately from delivery. Approval permits a retry; it does not execute an action.
- Use standard Mintlify components and inherited typography. Do not reintroduce starter graphics, unrelated product features, or font-serif card overrides.
- Regenerate the API reference with pnpm docs:openapi after contract changes. Do not edit openapi.json by hand.
- Run mint validate and mint broken-links from apps/docs. Preview using mint dev --port 3002 --no-open.
