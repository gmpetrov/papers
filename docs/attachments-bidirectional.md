# Email and SMS/MMS attachments

Implemented API contract: existing email send, email reply and phone message send
requests accept optional `attachments: [{ filename, contentType, content }]`.
`content` is canonical base64 (no data URL prefix). Text remains required.
Omitting attachments preserves existing SMS and email behavior. Replies include
only explicitly supplied files; they never silently forward incoming attachments.

```json
{
  "to": "+12025550100",
  "text": "Here is the document",
  "attachments": [{
    "filename": "note.pdf",
    "contentType": "application/pdf",
    "content": "JVBERi0xLjcK"
  }]
}
```

## Limits and transport

- At most ten nonempty files. Email: 5 MiB combined decoded bytes. MMS: 1,000,000
  combined decoded bytes. API requests are capped at 8 MiB, including base64.
- Names are text, 180 characters maximum; control characters and path separators
  are rejected. Content types must be valid bare MIME types.
- MMS accepts JPEG, PNG, GIF, WebP, PDF, vCard, calendar, MP3, AMR and MP4. Carrier
  support and carrier limits can be narrower; provider rejection remains visible.
- Email sends base64 content to Resend. SMS with files sends `type: MMS` and
  `media_urls` to Telnyx. Text-only requests continue to send `type: SMS`.
- Private R2 is shared by both channels. Stored files are never public bucket
  objects. Object keys contain generated identifiers, never filenames.

## Persistence and sending

Validation precedes quota consumption. Within the existing serialized operation
transaction, authorization, resource policy, approval and quota checks still
apply. Files are stored before a send operation is committed and before calling
the provider. Attachment metadata references exactly one email or phone message,
with a database check constraint and cascading parent deletion.

The complete input, including file bytes, participates in the idempotency hash.
A changed file with the same key conflicts. Replays do not upload or send again;
ambiguous provider outcomes retain existing reconciliation behavior. Approval
records contain file names, MIME types and sizes, not base64 content; their
request hash binds approval to the exact bytes.

Telnyx receives a separate random bearer capability for each stored file at
`GET /v1/attachment-media/{id}?token=...`. Only its SHA-256 hash is persisted.
The URL lasts one hour, is tied to an outbound phone message, and stops working
if the message fails or is deleted. This grants the provider access independent
of the sender's session lifetime. It requires the configured API base URL to be
public HTTPS. Content uses its original MIME type so the provider can consume
it; forced download, sandbox, no-sniff and no-store headers protect browsers.
Never log full capability URLs. User download links remain the existing
60-second capabilities that revalidate the original credential.

R2 and PostgreSQL cannot commit atomically. A database rollback after successful
R2 writes can leave unreferenced private objects. Parent deletion also does not
delete R2 bytes. Reconciliation/garbage collection of unreferenced objects is an
operational follow-up; do not apply a blanket bucket TTL to retained messages.

## Receiving and reading

Resend's existing asynchronous retrieval remains intact. Verified Telnyx MMS
webhooks now create phone messages and attachment metadata. The attachment lane
runs immediately after provider event ingestion, copies ephemeral media into R2,
and clears each source URL after storage succeeds. Duplicate events do not
create duplicate files. Message ingestion survives attachment download failure.

Both channels share bounded downloads (25 MiB per incoming file), leases,
exponential retries and eight-attempt exhaustion. Missing/expired provider media
remains visible as pending/failed, rather than dropping the message. MMS sizes
may be absent; actual bytes are always bounded. No redirects or credentials are
forwarded. Node pins DNS to validated public addresses at connection time;
production standalone Workers use public-Internet fetch. Local Worker emulation
does not enable this transport; use the Node jobs process locally.

`GET /v1/sms/{id}` now includes the same attachment metadata and storage statuses
as email detail. Existing attachment binary and signed-link routes support both
channels, checking current workspace/resource grants plus `sms:read` for MMS or
`inboxes:read` for email. Neither route reveals storage keys or provider URLs.

Dashboard compose/reply and phone compose support selecting/removing files.
Both message detail views offer authenticated downloads and availability refresh.
TypeScript send/reply inputs and Python sync/async send/reply methods accept
attachments. CLI send/reply accepts `--attach <paths...>`. Remote and stdio MCP
send tools accept the same attachment array; existing download tools handle MMS.

## Billing and rollout

MMS uses its own verified `SmsRate.maxProviderMicrosPerMms` ceiling. Existing
SMS ceilings are not reused. Billed workspaces reject MMS without a current MMS
ceiling. Reservations use twice the MMS provider ceiling; settlement continues
to use actual Telnyx reported cost. Set SMS rates first, then use
`scripts/set-sms-rate.ts --mms PREFIX USD_CEILING EXPIRY SOURCE_NOTE` with the
account's verified MMS rate including carrier fees. Updating an SMS rate clears
the old MMS ceiling to prevent inadvertently extending its validity.

Apply migration `20260917160000_multichannel_attachments`, regenerate Prisma,
then deploy web and jobs together. Reuse the existing private `ATTACHMENTS`
binding pointing to the private `papers` bucket and the jobs Worker's
production public transport configuration. Production storage provisioning and
migration status are recorded in [storage setup](storage.md). No paid message
or rate change was performed. Live carrier delivery needs a controlled production
smoke test after deployment and rate configuration.

Provider references:
[Resend email API](https://resend.com/docs/api-reference/emails/send-email),
[Telnyx MMS](https://developers.telnyx.com/docs/messaging/messages/mms-transcoding),
[R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).
