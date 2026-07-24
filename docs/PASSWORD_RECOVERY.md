# Customer password recovery

Ops Solutions supports self-service password recovery for active customer accounts.

## Security properties

- Forgot-password responses never reveal whether an email exists.
- Reset tokens contain 48 random bytes and only their SHA-256 hashes are stored.
- Tokens expire after 30 minutes and are single-use.
- Creating a new token invalidates every older unconsumed token for that user.
- A successful reset revokes every existing customer session for the user.
- Request and consumption endpoints are rate-limited using PostgreSQL-backed events, so limits work consistently across API replicas.
- Password reset email HTML escapes the display name and reset URL.
- Failed email delivery consumes the generated token so an undelivered credential cannot remain valid.
- Audit history records the password reset and the number of sessions revoked without storing the token, password, recipient list, or provider secret.

## Routes

- `POST /api/v1/auth/password/forgot`
- `POST /api/v1/auth/password/reset`
- Customer web screens: `/forgot-password` and `/reset-password?token=...`

The browser uses same-origin customer API proxies, which are protected by the platform CSRF boundary and return `Cache-Control: no-store`.

## Email provider

Password recovery reuses the existing email delivery adapter. Configure either Resend or Postmark in the server-only `.env` file.

```env
EMAIL_PROVIDER=resend
EMAIL_FROM_ADDRESS=security@example.com
EMAIL_FROM_NAME=Ops Intelligence
RESEND_API_KEY=replace-on-server
```

For Postmark, use `EMAIL_PROVIDER=postmark` and `POSTMARK_SERVER_TOKEN`.

When no provider is configured, the forgot-password endpoint still returns the generic accepted response but does not create a reset token. This prevents an unusable token from being persisted.

## Database objects

- `password_reset_tokens`
- `password_reset_rate_events`

Both tables are created idempotently when the API registers customer routes. Rate events older than two days are removed probabilistically during normal traffic to keep the table bounded.

## Incident response

For a suspected account takeover:

1. Disable the user or revoke their sessions using the session security tooling.
2. Confirm the email account is controlled by the customer.
3. Ask the customer to request a fresh reset link.
4. Review `account.password_reset` audit events.
5. Rotate the email provider token only if provider compromise is suspected.

Never copy a reset URL into logs, tickets, chat, or source control.
