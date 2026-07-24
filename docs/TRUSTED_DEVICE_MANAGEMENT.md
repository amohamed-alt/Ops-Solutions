# Trusted device management

## Purpose

Customers can explicitly trust a browser/device, review every trusted device, assign a recognizable name, and remove trust without terminating active sessions.

## Security model

- Device trust is account-scoped by `user_id`; it is never workspace-global.
- The stored fingerprint is a one-way SHA-256 digest derived from the existing user-agent and one-way IP hash.
- API responses never expose the fingerprint, raw IP, session token, token hash, cookie, or CRM data.
- Device identifiers are validated UUIDs and every mutation includes both `id` and `user_id` predicates.
- Labels are normalized, reject control characters, and are limited to 80 characters.
- Removing trust does not delete sessions. The next security read recalculates familiarity and risk immediately.
- Session termination remains a separate explicit action.

## API

- `GET /api/v1/customer/security` returns active sessions, trusted devices, summary counts and recent security events.
- `POST /api/v1/customer/security/devices/trust-current` trusts the current active session fingerprint.
- `PATCH /api/v1/customer/security/devices/:deviceId` renames a trusted device.
- `DELETE /api/v1/customer/security/devices/:deviceId` removes explicit trust.

All routes require an active customer session and are proxied through the same-origin Next.js customer API boundary with `no-store` responses.

## Audit events

- `device.trusted`
- `device.renamed`
- `device.revoked`

Event metadata contains only the opaque trusted-device UUID. Labels and fingerprints are not copied into the event stream.

## Operational notes

The account security schema upgrade is idempotent and protected by a PostgreSQL transaction advisory lock so multiple API replicas can start safely. Existing trusted-device rows remain compatible. Newly trusted devices use a friendly browser label instead of storing the full user-agent string as the display label.
