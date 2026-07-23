# Scheduled report email delivery

Scheduled report executions now move from export generation into provider-independent email delivery.

## Supported providers

Set `EMAIL_PROVIDER` to one of:

- `disabled` — safe default; exports continue to be generated and executions remain auditable without attempting delivery
- `resend`
- `postmark`

Required common settings:

- `EMAIL_FROM_ADDRESS`
- `EMAIL_FROM_NAME` (optional, defaults to `Ops Intelligence`)

Provider credentials:

- Resend: `RESEND_API_KEY`
- Postmark: `POSTMARK_SERVER_TOKEN`

Credentials remain in the production `.env` on the VPS and must never be committed or printed.

## Delivery lifecycle

1. The existing scheduled-report orchestrator creates an export job.
2. The export worker produces a tenant-scoped CSV or XLSX artifact.
3. The email delivery loop promotes the execution from `exporting` to `ready_for_delivery`.
4. One API replica atomically claims the execution using `FOR UPDATE SKIP LOCKED`.
5. The configured adapter sends the message with a stable execution idempotency key.
6. The execution is marked `delivered`, or retried with bounded exponential backoff.

Permanent provider rejections, invalid recipients, missing artifacts and oversized attachments fail without endless retries. HTTP 408, 409, 425, 429 and 5xx responses are treated as temporary. Delivery is attempted at most five times.

## Safety boundaries

- Every execution, schedule, export and workspace join includes `workspace_id`.
- Attachments are limited to 5 MiB.
- Recipient addresses and provider credentials are not written to structured logs.
- Stable idempotency keys prevent duplicate Resend sends when a request outcome is uncertain.
- Postmark receives the execution ID as message metadata for provider-side investigation.
- The API remains healthy when email is disabled or temporarily unavailable.

## Migration

Schema version 6 adds delivery attempt count, next attempt time, provider message ID and bounded metadata to `scheduled_report_executions`.

Rollback SQL is exported as `EMAIL_DELIVERY_ROLLBACK_SQL`. Rolling back removes delivery metadata only; schedules and generated exports remain intact.

## Production enablement

Add only the selected provider variables to `/root/Ops-Solutions/.env`, then redeploy the API container. Do not configure both provider keys unless operational policy requires a ready fallback.

Verify after enabling:

1. Create a saved view and scheduled report.
2. Set the next run a few minutes ahead.
3. Confirm the export becomes `completed`.
4. Confirm the execution becomes `delivered` and has a provider message ID.
5. Verify the attachment opens and belongs to the expected workspace.
6. Test a temporary provider failure and confirm a future `next_delivery_attempt_at` is recorded.

## Current limitations

- Provider webhooks for bounce, complaint and suppression events are not yet ingested.
- Customer-managed unsubscribe tokens are not yet implemented; the email links to the authenticated schedule settings page.
- PDF remains outside the current export formats.
