# Inbound email routing

The receiver uses `received_for` from the signed Resend event to decide whether
any active inbox can receive the message. It then retrieves the provider message
and uses its `received_for` to select destination inboxes. The installed Resend
SDK declares this field on received messages and events. Visible To/Cc headers
are never used to grant inbox access; neither are sender-supplied message headers.

Each active destination gets its own tenant-owned message row. The stored `to`
contains only that inbox's address, avoiding disclosure of other envelope
recipients through message metadata. Recipients can still see any addresses
written into the sender's message body. Thread lookup stays within the inbox.
The unique inbox/provider-message pair prevents duplicate messages on replay;
message creation and the corresponding activity event share a transaction.

Unknown and archived destinations are discarded. If none of the signed event's
envelope recipients matches an active inbox, the processor does not fetch the
body or attachments. Completed provider-event payloads are reduced to the
provider email ID, preserving the event ID as a deduplication record. Mixed
deliveries store messages only for matching active inboxes.

Missing envelope data fails closed: processing retries with bounded backoff,
then moves to dead letter after eight attempts. Pending/dead-letter events retain
their ingress payload for investigation; automatic retention limits for those
records are not yet implemented. Operators must not replay a completed discarded
event after creating a new inbox at its former destination.

`packages/core/tests/email-routing.test.ts` verifies signed multi-workspace
delivery, normalized and duplicate recipients, BCC-style delivery with the actual
recipient absent from visible headers, archived/unknown destinations, replay
deduplication, payload reduction, and missing envelope data in either the event
or retrieved message. All four tests passed locally. These use provider fixtures;
real BCC and multi-recipient provider acceptance tests remain launch checks.

Resend's [receiving guide](https://resend.com/docs/dashboard/receiving/introduction)
and [content retrieval guide](https://resend.com/docs/dashboard/receiving/get-email-content)
describe the webhook and retrieval flow. They do not replace verification of
the actual provider envelope fields for supported delivery scenarios.
