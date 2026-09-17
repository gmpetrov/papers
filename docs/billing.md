# Plans, Stripe, and prepaid communications

Implemented September 17, 2026. Public page: `/pricing`. Workspace billing:
`/dashboard/billing`. All prices are USD before applicable taxes.

| Plan | Monthly | Inboxes | Recipient emails/month | Attachment storage | Members |
| --- | ---: | ---: | ---: | ---: | ---: |
| Free | $0 | 3 | 3,000 | 3 GB | 1 |
| Developer | $20 | 10 | 10,000 | 10 GB | 2 |
| Scale | $200 | 150 | 100,000 | 100 GB | 10 |

`packages/contracts/src/plans.ts` is the shared public catalog. Custom domains
(10/150 on paid tiers) remain a future entitlement, clearly labeled coming soon.
Voice and MMS are not sold. Additional inbox/domain prices exist in Stripe for
future add-ons but are not enabled in self-service checkout yet.

## Production Stripe catalog

Account: `acct_1TglYsRbMiIVQuK6`. `scripts/setup-stripe.mjs` validates the account
before creating catalog objects. Credentials live in ignored environment files
and Cloudflare secrets. Never commit or print them. The script reuses fixed
product IDs and versioned price lookup keys; it does not charge customers.

- `papers_developer_monthly_v1`: $20/month.
- `papers_scale_monthly_v1`: $200/month.
- `papers_us_number_monthly_v1`: $3/month for one standard US rental.
- `papers_topup_{1000,2500,5000,10000}_v1`: $10/$25/$50/$100 prepaid credit.
- Reserved catalog entries: additional inbox/domain at $2/month, 1,000 emails at $2.
- Active webhook: `we_1UGdujRbMiIVQuK6l8ZaaJsG`, endpoint
  `https://www.papers.bot/api/webhooks/stripe`, API `2026-08-26.dahlia`.
- Billing portal configuration: `bpc_1UGdkcRbMiIVQuK60T5f9ibv`.
  Invoice history, payment-method updates, and period-end cancellation enabled.
  Plan changes use Papers endpoints, not arbitrary portal product changes.

There is no shared transferable wallet or Stripe cash balance. Checkout collects
payment for Papers usage. Papers maintains its own prepaid ledger; Stripe Billing
credit grants are deliberately not also applied, which would account for the
same purchased credit twice. There is no second month-end SMS charge.
Recurring subscription invoices and top-up payment receipts remain in Stripe.
Tax collection/registrations were not changed by this implementation.

## Local Stripe test mode

Run `node scripts/setup-stripe.mjs --test` to reconcile the matching test-mode
catalog. It reads the test key from ignored `.env`, validates the account and
key mode, and saves the portal ID and newly created webhook secret there.
The webhook URL uses `NEXT_PUBLIC_APP_URL`; it must be publicly reachable HTTPS.
Local billing is enabled with `BILLING_ENABLED=true`.

Test-mode webhook: `we_1UGeUfRbMiIVQuK6cIwTOtTS`, pointing to
`https://dev.chaindesk.ai/api/webhooks/stripe`. Portal configuration:
`bpc_1UGeUeRbMiIVQuK6zXwVjIVq`. At setup the development endpoint returned 503;
run the local web app, jobs process, and development tunnel to receive events.
Restart existing processes after changing `.env`. `pnpm dev` starts both the web
app and background jobs. Turbo must allow billing/provider variables through its
`globalEnv` list; adding values to `.env` alone does not bypass this filter.
After fixing that allowlist, development Checkout creation and signed webhook
processing through the public development URL were verified successfully.

## Money and concurrency

- Money is integer micro-USD (`BigInt`). Provider decimal charges round upward to
  a micro-dollar; floating-point arithmetic is not used for ledger mutations.
- Workspace billing advisory locks serialize credits, debits, and reservations.
- PaymentIntent status, customer, currency, and amount are checked against a
  server-created checkout record. Only `succeeded` payments grant credit.
- A payment-ID ledger key makes repeated callbacks idempotent.
- Before SMS provider submission, reserve twice the verified maximum provider
  price per segment. The longest matching unexpired `SmsRate.prefix` wins.
  GSM-7 extension characters and UTF-16 surrogate pairs count toward segments.
- The send transaction includes its operation, message, quota, and financial
  reservation. Concurrent calls cannot spend the same funds.
- Definitive provider rejection releases the reservation. Unknown outcomes retain
  it indefinitely pending evidence; retries never blindly resend an SMS.
- Signed final cost callbacks settle at twice reported total provider cost.
  Newer cost revisions create delta entries. Message deletion does not delete
  financial entries. Inbound IDs are opaque deterministic hashes for replay
  protection across message retention.
- Unknown inbound cost, unsupported currency, an outbound cost above its reserved
  ceiling, refunds, and disputes freeze new spending for operator reconciliation.
  Refunds/disputes do not silently subtract an invented charge or grant funds.

The prepaid balance also pays email overages at $0.002 per recipient email.
Paid subscriptions are upfront. Included email allowances follow the paid
subscription period, with no rollover; Free follows UTC calendar months.
Upgrades are prorated, conditional on payment, without resetting consumption.
Downgrades use a Stripe schedule for the next renewal. Cancellation stops future
renewals. Existing resources are retained when a lower plan reduces capacity.

Provider acceptance counts outbound recipient email usage. Reservations prevent
concurrent quota overspend; definitive rejections restore units and any prepaid
overage debit. Inbound deliveries consume the same allowance. Excess inbound
mail without funded overages is not stored; this does not prevent Resend from
charging the platform for receipt. Attachment metadata allocation enforces the
storage allowance; over-quota inbound attachments are not stored. Workspace and
credential safety limits remain additional restrictions; plan upgrades do not
silently raise user-selected daily limits. Owners can raise inbox capacity in
Organization settings (platform plan ceilings still apply).

## Automatic top-ups

Manual choices: $10, $25, $50, $100. Unused credit carries forward.
Optional default: add $25 below $5 available, at most $100/UTC month. The owner
can change the threshold, amount, and monthly ceiling. A completed manual top-up
saves a customer-bound card for future explicitly authorized automatic top-ups.

A durable attempt is created before requesting payment, with an idempotency key.
The monthly ceiling counts paid and pending attempts. Pending payment does not
fund sends. Card decline/authentication failures disable auto-top-up until the
owner resolves payment and opts in again. Network failures reuse the original
attempt. A create request with no saved PaymentIntent older than 23 hours is
held for operator reconciliation, avoiding reuse beyond Stripe's idempotency
retention. The jobs Worker performs retries, not browser timers.

## Phone activation and messaging controls

Phone rental checkout and provisioning are enabled. At the owner's direction,
Papers assumes unassigning a number from its messaging profile stops incoming
messaging. This is an accepted operating assumption, not a verified carrier
billing guarantee. Automatic detachment at zero available balance and restoration
when funded remain enabled.

Outbound sends still require unexpired, destination-specific rate ceilings;
unknown destinations fail closed. Set rules with `scripts/set-sms-rate.ts` using
account-specific rates including carrier fees. Account/carrier registration and
provider availability requirements still apply.

A paid phone rental is a separate $3 monthly Stripe subscription. Customers
select a standard US number first, then the confirmation button opens Stripe
Checkout. Selection is stored server-side; signed payment reconciliation creates
the rental and provisions exactly that number with an idempotent operation.
Unpaid/abandoned checkout never provisions a number. The return URL is
`/dashboard/numbers`. Billing links to number selection instead of selling empty
rentals. Existing unassigned rentals can still be managed in the Stripe portal.

Inventory is rechecked before checkout and after payment. Definitive provisioning
failure or unavailable inventory cancels the subscription and refunds its payment
using a durable checkout state and Stripe idempotency. Ambiguous provider outcomes
remain pending for reconciliation, never reordered/refunded speculatively.
Refund requests are not a promise of immediate bank settlement. Nonstandard
inventory is excluded from self-service search.

Customer APIs and UI show $3/month and $0 setup, never provider quotes. SMS detail
and usage totals use settled customer charges from the ledger; unpriced/unsettled
messages show pending. Raw provider prices and costs remain internal. Approval
previews also use retail prices. Standard-number eligibility remains an internal
$1.10 cap on each upfront/monthly provider cost.

No initial top-up is required to buy or assign a rental. The first successfully
paid standard phone rental grants $0.50 once per workspace, recorded with a
unique ledger key; retries, renewals, and additional rentals cannot repeat it.
There is no customer-funded receiving reserve. The $2-per-number receiving
budget is internal to Papers and never subtracted from customer funds. Incoming
charges are capped to available customer credit without consuming pending send
reservations; Papers absorbs excess provider costs. Raw costs remain on SMS
records, while settledMicros records the amount charged to the customer.
At zero available funds, expired rental, or blocked billing, jobs pause messaging, detach
that number's messaging profile, and confirm the provider state. A shared
messaging profile is never disabled. Top-up can restore messaging. The internal budget is not a hard limit on carrier costs;
the owner has accepted the detachment assumption.
Canceled rentals release the number after their paid period. Unpaid rentals are
suspended and released after seven days without paid coverage. Released/failed
numbers schedule rental cancellation. Number loss on cancellation is irreversible;
show this policy before customers activate phone rentals. Refund exceptions and ambiguous provisioning outcomes require operator review.

## Operations and verification

Production deployment on 2026-09-17:

- Web version: `1f0ae22c-e29c-4877-b830-45f15cfca274`.
- Jobs version: `12465fa9-1fd5-4b02-8586-e1a1d5ffed6f`.
- Billing migration applied; billing enabled; phone activation gate remains closed.
- Full TypeScript suite: 278 tests passed before the final delayed-inbound fix;
  the subsequent focused Telnyx/billing/Stripe suite passed all 28 tests.
- Python SDK: 46 tests passed. Production build and package typechecks passed.
- Live unpaid Developer and top-up Checkouts verified and expired without charges.
- Delayed incoming SMS is still recorded while a number is billing-suspended or
  releasing, so in-flight provider usage is not discarded during suspension.

- Stripe ingress verifies signatures and livemode before durably enqueueing an
  event. The jobs lane processes retries independently of other provider lanes.
- Owner sessions exclusively control checkout, changes, portal, and auto-top-up.
  Admin sessions may read balances; agent credentials and impersonation cannot.
- Public API contracts document all billing routes.
- `BillingAccount.blocked` is an operator-only reconciliation hold. Resolve the
  underlying payment/currency/provider discrepancy before clearing it.
- For a stuck checkout, resume with the same idempotency key. Pending subscription
  checkouts for the same plan are reused. Selecting another plan first expires
  the abandoned Stripe session under the workspace lock, then creates the new
  checkout. Completed sessions and failed/ambiguous expiry block replacement to
  prevent duplicate subscriptions. Already-expired sessions can be replaced.
- Look for `ProviderEvent.provider = stripe` with `pending`/`dead_letter`, and
  old `BillingReservation.status = reserved`. Never clear an ambiguous reservation
  solely because time elapsed.
- Unit/integration tests cover balances under concurrent sends, duplicate credits,
  missing/foreign costs, retained financial history, quota ceilings, signed
  ingress, mismatched payments, actual send denial before Telnyx, and top-up caps.
  No live customer charge is used as a test.
