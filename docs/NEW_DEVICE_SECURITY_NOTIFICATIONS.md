# New-device Security Notifications

Ops Solutions sends a best-effort security email when a customer signs in from a browser and network fingerprint that has not previously been observed for the same account.

## Detection policy

A recent session becomes a notification candidate only when:

- the account already has at least one older session;
- no older session for the same `user_id` has the same browser user-agent and one-way IP hash;
- the session was created within the configured lookback window;
- no notification record already exists for that user and session.

The first session created for a new account is deliberately excluded so signup does not create a false security alert.

## Delivery guarantees

- Delivery uses the existing Resend or Postmark adapter.
- Provider idempotency keys prevent duplicate sends when supported.
- PostgreSQL `FOR UPDATE SKIP LOCKED` claiming supports multiple API replicas.
- A unique database constraint prevents duplicate notification records.
- Temporary provider failures retry with bounded exponential backoff.
- Permanent rejection or five failed attempts marks the notification failed.
- Login is never blocked by email delivery or provider availability.

The worker starts with the API email-delivery bootstrap when an email provider is configured. The default polling interval is 60 seconds and can be adjusted with:

```text
NEW_DEVICE_NOTIFICATION_POLL_INTERVAL_MS=60000
```

The value is clamped to a minimum of 30 seconds.

## Privacy and security

- Raw IP addresses are not stored or emailed.
- Session tokens and token hashes are never returned to the customer or included in messages.
- Matching is strictly scoped to one `user_id`.
- Email content includes only a normalized browser label, device category, UTC time, and a link to Account Security.
- Audit metadata stores only the internal notification UUID.
- Customer-controlled display names are HTML escaped.

## Operations

Delivery state is stored in `account_security_notifications` with `pending`, `sending`, `delivered`, and `failed` states. Operators can inspect aggregate status without reading session credentials:

```sql
SELECT status, COUNT(*)
FROM account_security_notifications
GROUP BY status
ORDER BY status;
```

A failed provider configuration does not prevent sign-in. It records failed notification attempts while the normal runtime configuration audit continues to report missing email provider settings.

## Backlog

- Add customer opt-in or opt-out preferences after a product policy decision.
- Add provider webhook reconciliation for bounced or suppressed security emails.
- Add workspace-localized security email copy once account-level locale preferences exist.
