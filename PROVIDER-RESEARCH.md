# Provider decisions

Research date: 16 September 2026. Prices are indicative published rates, not quotes. Recommendations are engineering judgments for an early-stage agent infrastructure service. Incorporation country, customer geography, expected volume, and provider approval remain unresolved.

## Selected first-release providers

Launch scope is email with Resend and phone numbers/SMS with Telnyx. Card research below is retained for a later phase; no card implementation or approval is required to launch.

| Capability | First choice | Alternative | Decision |
| --- | --- | --- | --- |
| Email | Resend | None needed initially | User-selected; implement our own persistent mailbox layer |
| Phone numbers and SMS | Telnyx | Twilio (research only) | User-selected; validate inventory, delivery and permitted use in launch countries |
| Virtual payment cards — deferred | Stripe Issuing (candidate) | Lithic; Marqeta | Future research only; outside first-release scope |

## Phone providers

**Telnyx is the selected launch provider.** Its published US local SMS rate starts at $0.004 per message part for sending and receiving, plus carrier fees. Local numbers start at $1/month, with an additional $0.10/month for SMS/MMS capability. This makes it attractive when each agent has a dedicated number. Validate actual number inventory and onboarding for every launch country. [Messaging pricing](https://telnyx.com/pricing/messaging), [number pricing](https://telnyx.com/pricing/numbers).

**Twilio is the strongest alternative for an implementation team already familiar with it.** Its published US local-number price is $1.15/month; inbound and outbound long-code SMS are each $0.0083 per segment before applicable extras. Its country-by-country regulatory guides are useful for planning rollout. This research does not establish that either vendor has better delivery reliability; test that with the actual traffic and destinations. [Pricing](https://www.twilio.com/en-us/sms/pricing/us), [country guidelines](https://www.twilio.com/en-us/guidelines).

Illustration: 100 US SMS-capable local numbers and 10,000 total SMS parts/month cost roughly $150 in Telnyx base charges versus $198 in Twilio base charges. This excludes carrier fees, registration, taxes, international destinations, media messages, and support agreements. It is not a total-cost quote.

Before production, confirm multi-tenant provisioning/resale, end-user registration responsibilities, country-specific documents, number release rules, sender registration, opt-outs and delivery reporting with the selected provider. A phone number is not a guarantee that every website accepts it for verification. Do not market universal OTP compatibility. Twilio explicitly documents restrictions around short-code reception in trial accounts. [Trial restrictions](https://help.twilio.com/articles/360036052753-Twilio-Free-Trial-Limitations).

Implement Telnyx first behind a narrow provider interface. Do not build automatic number-provider failover: an allocated number cannot simply switch providers during an outage.

## Card providers — deferred research

The requirement is **card issuing**, not accepting customer card payments. A future card phase could offer funded virtual payment cards; a revolving credit product would be a separate underwriting and funding decision.

**Stripe Issuing — candidate for the deferred card phase.** Supports virtual cards, spending controls and real-time authorizations. Stripe documents regional eligibility and using Connect for cardholders outside your own workforce. This makes it a reasonable first candidate for a SaaS platform, but documentation access and sandbox access do not establish approval for this specific agent-operated program. [How Issuing works](https://docs.stripe.com/issuing/how-issuing-works), [regional availability](https://docs.stripe.com/issuing/global).

Published virtual-card creation fees are $0.10 in the US, £0.10 in the UK and €0.10 in the EU. These are issuance fees, not the complete program cost. Stripe recommends Issuing Elements to display card details without routing them through our servers. [Virtual cards](https://docs.stripe.com/issuing/cards/virtual).

**Lithic — strong API-focused alternative.** Provides issuing, money movement, program management, a sandbox and an MCP server. Evaluate it if its approved program, commercial terms and jurisdiction fit are better than Stripe's. No comparable all-in program quote or eligibility for our business was established in this research. [Developer documentation](https://docs.lithic.com/), [agent integration](https://www.lithic.com/blog/mcp-server-agentic-payments).

**Marqeta — alternative for a more customized card program.** Its agentic-payments offering explicitly includes virtual-card provisioning, spend controls and transaction workflows through MCP. Consider it if the product needs deeper program customization and its commercial proposal justifies the integration. Do not assume pricing or onboarding times without a quote. [Agentic payments](https://www.marqeta.com/platform/mcp-server).

Provider evaluation must resolve: legal entity and customer locations; business versus consumer users; agent-delegated use; who the legal cardholder is; KYB/KYC; approved funding flow; authorization controls; 3DS challenges; refunds and disputes; secure credential delivery; reserves, minimum commitments and other fees. Revisit these questions when the card phase is approved; no card sandbox integration is needed now.

For Stripe, authorization requests have a documented two-second response window. Configure and test a decline-on-timeout/error policy; never put an LLM or human approval round trip in this path. Captures are distinct from authorizations, so freezing a card is not a promise that a previous purchase can no longer settle. [Real-time authorizations](https://docs.stripe.com/issuing/controls/real-time-authorizations), [transactions](https://docs.stripe.com/issuing/purchases/transactions).

## Resend architecture implication

Resend receives mail for addresses under a configured domain and emits webhooks. The receiving event carries metadata; retrieve content and attachments through its APIs. Our service owns address allocation, tenant routing, persistence, threads, search, access control and retention. Use a dedicated receiving subdomain and discard or quarantine unallocated recipients; do not automatically create mailboxes for arbitrary incoming addresses. [Receiving guide](https://resend.com/docs/dashboard/receiving/introduction).

## Distribution in AI products

| Product | Verified integration path | Release requirement |
| --- | --- | --- |
| Claude | Remote MCP connector; public Connectors Directory submission | OAuth, tool annotations, documentation, review credentials and directory approval |
| ChatGPT | MCP-backed plugin; current official submission flow | Verified publisher, review materials, approval followed by explicit publication |
| Grok | Public custom MCP connector and catalog of OAuth connectors | Ship and test the custom connector; public catalog submission route remains unverified |

Claude documents its [submission requirements](https://claude.com/docs/connectors/building/submission). OpenAI's former Apps SDK submission URL currently redirects to its [plugin submission documentation](https://developers.openai.com/plugins/deploy/submission), which describes the shared ChatGPT/Codex Plugins Directory. Grok documents [custom MCP and catalog connectors](https://docs.x.ai/grok/connectors), but the reviewed documentation did not establish a public self-service catalog submission process. Track catalog placement as an external dependency, not a guaranteed engineering deliverable.

## Cloudflare compatibility

Host compute on Workers. Current Cloudflare documentation recommends vinext for Next.js applications, while retaining an OpenNext deployment path. Because the requested framework is Next.js, preserve that source structure and validate the deployment adapter in a small runtime spike; do not silently replace application APIs or assume compatibility. [Next.js deployment guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/).

Cloudflare documents Prisma with PostgreSQL through Hyperdrive using `@prisma/adapter-pg` and `pg`. PostgreSQL itself needs a managed host; Hyperdrive is a connectivity/pooling layer. Disable query caching for authorization, permissions and financial state. [Prisma integration](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/prisma-orm/).
