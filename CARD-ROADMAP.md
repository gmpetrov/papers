# Deferred roadmap: credit/payment cards

Status: future reference only. Excluded from the first release, which is email (Resend) and phone numbers/SMS (Telnyx). Do not implement this document until a later card phase is explicitly approved. All requirements below apply only to that future phase.

Revalidate provider capabilities, geography, pricing and program approval before starting. Stripe Issuing is a candidate; see PROVIDER-RESEARCH.md for alternatives.

## Virtual cards and financial state

Expose eligibility/onboarding status, card create/list/get, spending policy, freeze/unfreeze/close, authorization history and settled transactions. Live creation requires an approved program, verified customer/cardholder, supported region and available funding.

Use integer minor-unit amounts and explicit currencies. Distinguish platform subscription charges from card-program funds. Never treat a successful SaaS billing payment as automatic funding of the issuing balance.

Persist authorizations/holds, reversals, captures, refunds, fees and adjustments as distinct events. Maintain an append-only financial journal with balanced entries and reconciled balances for the approved funding model. Use database transactions and locks/atomic reservations to prevent concurrent authorization overspend. Test partial captures, duplicate events, late settlement and out-of-order updates.

Mirror supported limits into provider controls. Application-level controls add granularity; do not imply that setting a local budget alone restricts the card network. Unsupported policy types must fail explicitly, not silently degrade.

The real-time authorization endpoint verifies the provider signature, evaluates deterministic policy and atomically records/reserves the decision within the provider deadline. No queues, LLMs or interactive approvals in this synchronous path. Configure decline on timeout/error and test it. Queue subsequent notifications and reconciliation.

Ordinary responses expose only safe metadata such as last four digits. Never return PAN/CVC in generic REST lists, MCP output, logs, analytics or model context. Use provider-hosted secure display for authorized humans.

For agent checkout, implement a separate approved credential/token delivery boundary to a trusted executor that can fill payment fields without putting secrets in the model transcript. This is a required product design milestone: issuing a card alone does not enable an agent to pay. Until the provider-supported mechanism, credential scope and challenge/3DS handling are proven, keep automated checkout sandbox-only. Human approval for a purchase occurs before checkout, with expiry; 3DS may still require human interaction.

## Future implementation surface

A later phase may introduce card and transaction APIs, corresponding MCP tools/SDK methods/CLI commands, dashboard pages, provider adapters, and Cardholder, Card, SpendingPolicy, Authorization, Transaction, LedgerAccount and LedgerEntry models. Add these only with a separately approved design and migrations. Extend impersonation restrictions to payment approvals and card credential access.

Future acceptance tests include concurrent authorization budget enforcement, decline on authorization timeout, partial/late captures, reversals/refunds, reconciliation, and no PAN/CVC in model output or logs. None is a first-release requirement.
