# Outbound SMS investigation — September 16, 2026

## Request

- From: `+15716986634`
- To: `+33661838314`
- Application timestamp: `2026-09-16T10:19:56.034Z`
- Application operation: `fe5707ac-9daf-435c-b172-b7d06ca74a14`
- Application message: `cmu3y8sn30006psp7o2n3538b`
- Telnyx messaging profile: `4001a0a9-a6e0-4d84-842b-eb9a766ea0c5`

## Verified evidence

The application operation changed to `unknown`, with error
`provider_outcome_unknown`, at `10:19:56.380Z` (346 ms after creation).
Its result is null; no provider message ID, HTTP status, exception detail, or
request ID was retained. The SMS row remains `pending` and has no provider ID.
This pending label does not establish that Telnyx queued the SMS.

Read-only Telnyx API checks confirmed an active number, an enabled messaging
profile allowing FR and US, and USD 5.20 available credit. The number uses A2P
and advertises `international_outbound: false`. Telnyx documents alphanumeric
fallback for international A2P traffic, so this flag alone does not prove the
cause of this attempt's failure.

Inspected the authenticated Telnyx portal using the existing Chrome session:

- Detail Record Search, September 9–16: only the inbound message at 10:18:28 UTC.
- Message Deliverability, Today, Outbound, all types/products: zero total and
  zero in-flight messages for Papers development.
- Webhook Deliveries: only `message.received`, successfully delivered at
  10:18:29 UTC. No outbound delivery event was listed.
- Generated and downloaded message detail report
  `0683d54f-4c32-4c67-9ef3-6b32f0026231`, covering September 15 12:00 UTC through
  September 16 12:00 UTC, all record types and both directions. The CSV contains
  only the inbound message, with no outbound or error row.

No SMS was sent or retried, and no messaging configuration was changed.

## Conclusion and remaining limit

There is no provider acceptance evidence in the application, portal, webhook
history, or exported MDR report. The send may have failed before Telnyx accepted
it, but these records cannot distinguish a transport failure, API rejection,
or response-handling failure. The 346 ms duration is inconsistent with the
current provider client's 15-second timeout, but the original exception is lost.
The exact request needs Telnyx internal API ingress logs; no such request-log
view was found in the inspected portal sections. Do not label it delivered,
failed, or safely retryable solely from missing MDR records.

## Prepared support message (not sent)

Please trace a POST /v2/messages attempt on our account at
2026-09-16 10:19:56 UTC (search ±2 minutes), from +15716986634 to +33661838314,
using messaging profile 4001a0a9-a6e0-4d84-842b-eb9a766ea0c5.
Our application recorded an unconfirmed provider outcome after 346 ms and did
not retain a Telnyx request/message ID or HTTP error. Your portal shows zero
outbound/in-flight messages, no outbound webhook, and the all-record-types MDR
export 0683d54f-4c32-4c67-9ef3-6b32f0026231 contains only the preceding inbound
message. Please check API ingress logs for whether this request reached Telnyx,
the HTTP status/error code or assigned message ID, and whether this A2P number's
international route/alphanumeric fallback to France was eligible at that time.
Please do not resend the message or change account configuration.

## References

- https://developers.telnyx.com/docs/messaging/messages/traffic-type
- https://developers.telnyx.com/api-reference/mdr-detailed-reports/get-all-mdr-detailed-report-requests
- https://support.telnyx.com/en/articles/5170721-best-practices-for-contacting-support

## Authorized live test — 12:58:25 UTC

The user subsequently authorized one test SMS to the same recipient. Submitted
`Papers SMS delivery test.` directly to Telnyx using the application's sender,
messaging profile, SMS type, and profile webhooks. No retry was made.

Telnyx rejected the request after 266 ms:

- HTTP status: `409`
- Error code: `40306`
- Title: `Alpha sender not configured`
- Detail: `The messaging profile doesn't have an associated alphanumeric sender ID.`
- Provider request ID: `1b3a7dc3-fdd8-93ea-a5d5-4b8e281737b1`
- Request timestamp: `2026-09-16T12:58:25.306Z`

This establishes the current outbound blocker: international A2P fallback needs
an alphanumeric sender ID on the messaging profile. It is consistent with the
original failure, although the original response was not retained. The current
application treats all HTTP 409 responses as ambiguous (`sms.ts` excludes 409
from definitive rejections), which explains how this error can leave a message
pending with an unknown operation. The direct diagnostic send created no Papers
message row and did not change the original message.

## Fix and verification

Configured `alpha_sender=Papers` on the existing messaging profile and verified
it with a GET. A single follow-up test returned HTTP 403 / `20014`, "Account
unverified", request ID `78483043-9ce7-9692-8022-c99af71f70b8`. The Telnyx portal
confirms Level 1 COMPLETE, identity ACCEPTED, Level 2 INCOMPLETE. Its Level 2
panel explicitly lists international alphanumeric sending as a Level 2 feature.
The request form requires company name and contact phone number; it was not
submitted. No verification claims or account identity information were changed.

Application handling now marks HTTP 409 carrying only `40306` as failed and
shows configuration guidance. Other conflicts remain unknown. Code `20014`
shows account verification guidance. The original legacy operation remains
unchanged because its actual response was never captured.

## Successful test after Level 2 verification

After the user confirmed verification completion and requested a test, sent one
SMS directly through Telnyx to the same recipient. HTTP 200 accepted message
`4031a0aa-cb6d-469e-9f5a-ce6e7e502020` from alphanumeric sender `Papers`.
A subsequent GET confirmed `delivered` on Bouygues Telecom, completed at
`2026-09-16T15:17:36.280Z`, with no delivery errors. The test text was
`Papers SMS test after Level 2 verification.` No automatic retry was performed.
This confirms provider delivery; this direct test did not create a Papers SMS
row or exercise the dashboard send flow.

## Two-way numeric sender investigation

The user requested replies in the same SMS conversation. Alphanumeric `Papers`
cannot receive replies. Read the current number configuration: Telnyx advertises
`eligible_messaging_products: [A2P, P2P]`, but the active product is A2P with
international SMS capability flags false.

Attempted the documented `messaging_product: P2P` update through both
`PATCH /v2/messaging_phone_numbers/+15716986634` and
`PATCH /v2/phone_numbers/3050164381720511874/messaging`. Both returned HTTP 200
but still reported A2P; a later independent GET also reported A2P and unchanged
international capability flags. The portal number Messaging tab exposes profile
assignment and deliverability indicators, but no traffic-type selector. No SMS
was sent during these attempts, and no successful route change is claimed.

Provider action is needed to explain the ignored update and confirm a supported
numeric-sender route for the actual Papers conversational use case to France.
Do not promise two-way delivery based solely on P2P eligibility. Verify the
outbound numeric sender and a real inbound reply after any successful change.
