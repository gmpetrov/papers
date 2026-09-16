# Email send recovery

Outgoing sends include a `papers_operation` Resend tag. Signed `email.sent`, `email.delivered`, `email.bounced`, `email.complained`, `email.failed`, and `email.suppressed` webhooks use this tag to recover the provider ID when the send response was lost. The operation must belong to an outbound email, and the webhook sender must match the stored sender. A conflicting provider ID is never rebound.

The send response and webhook share transactional confirmation logic. Confirmation emits one `email.sent` application event and clears an earlier timeout. Late confirmation does not downgrade delivery, bounce, or complaint state. An operation being completed means Resend accepted the send; the message retains its separate delivery status.

Subscribe the Resend webhook to the outbound event types above as well as `email.received`, and keep the jobs processor running. Resend documents tag propagation at https://resend.com/docs/dashboard/emails/tags.

No automatic second send is performed. Reusing the original client idempotency key returns the existing operation. Without a matching webhook, an ambiguous operation remains unknown; reconciliation for missing webhooks is still outstanding. Older sends without the operation tag cannot be recovered through tag matching.

Tests use PostgreSQL and mocked provider responses. They cover a lost response, delivery before the sent event, repeated confirmation, and a webhook arriving before the HTTP timeout. No real email is sent by these tests.

The development webhook subscription was verified to include these outbound events. Delivery updates use atomic state checks so concurrent workers cannot overwrite a complaint or suppression with a late delivery event.
