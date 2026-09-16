# Workspace usage

Owners and admins can open **Usage** in the dashboard or call
`GET /v1/workspace/usage?month=2026-09` with their Better Auth session.
API keys, delegated OAuth, members, and impersonated sessions cannot access the
workspace-wide summary. The default month is the current UTC month.

Email counts are grouped by direction. SMS counts, reported segments, and provider
costs are grouped by direction and currency. Currencies are never added together.
Costs are decimal strings; unreported amounts remain null, while a reported zero
remains zero. Each SMS group reports how many messages have known segment/cost
values so partial reporting is visible. Values reflect a consistent database
snapshot and include only the selected organization.

The period uses message creation time with an inclusive month start and exclusive
next-month start. This is operational usage, not successful-delivery counts,
quota reservations, an invoice, or the provider's billing period. Later signed
callbacks can update the reported costs of older messages. Deleted messages no
longer contribute to this view; financial ledger retention and reconciliation
remain separate unfinished work.

No subscription collection, plan enforcement, invoice creation, number rental
cost aggregation, currency conversion, or email cost estimates are implemented
by this page. These costs must not be presented as customer charges.
