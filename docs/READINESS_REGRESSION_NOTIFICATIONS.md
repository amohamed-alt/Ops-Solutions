# Readiness regression notifications

This runbook covers durable email delivery for onboarding-readiness regressions and recoveries.

## Guarantees

- A delivery is uniquely keyed by incident, snapshot, and notification kind.
- PostgreSQL `FOR UPDATE SKIP LOCKED` allows multiple workers without duplicate claims.
- `last_notified_at` is updated only after a regression email is successfully delivered.
- Recovery emails are created from resolved incidents and are independently idempotent.
- Delivery failures use bounded exponential retry and stop after five attempts.
- Email provider outages never remove or resolve the underlying incident.
- Recipients are resolved at send time from active workspace owners and admins only.
- Queries and updates remain scoped by both workspace and incident/delivery identifiers.
- Raw CRM data, OAuth tokens, session data, IP addresses, and credentials are never included.

## Run

Preview current incidents first:

```bash
bash scripts/readiness-regression-monitor.sh --action status --limit 200
```

Process up to 50 due notifications:

```bash
bash scripts/readiness-regression-notifications.sh --limit 50
```

The command returns only aggregate counts and provider-neutral failure messages. It does not print recipient lists or provider credentials.

## Email configuration

Delivery uses the existing Resend/Postmark adapter and the same environment variables as operational alerts. No new secret is required. If no provider is configured, the delivery remains failed and retryable while the incident remains durable.

## Database lifecycle

`readiness_regression_deliveries` is created idempotently under a PostgreSQL advisory lock. Important fields:

- `kind`: `regression` or `recovery`
- `status`: `pending`, `sending`, `delivered`, or `failed`
- `attempts` and `next_attempt_at`: retry control
- `recipients`: the recipient snapshot used for that attempt
- `provider_message_id`: delivery traceability

The unique constraint on `(incident_id, snapshot_id, kind)` is the final duplicate-delivery boundary.

## Operational response

1. Check the readiness incident and latest snapshot.
2. Confirm that the workspace has at least one active owner or admin.
3. Confirm Resend or Postmark configuration through the existing runtime configuration audit.
4. Re-run the processor after fixing the provider or membership issue.
5. Do not manually edit `last_notified_at`; successful delivery updates it atomically.

## Rollback

Stopping the notification processor is safe. Existing incidents and queued deliveries remain in PostgreSQL. Removing the feature does not require dropping the table; retained rows provide an audit trail and can be resumed after redeployment.
