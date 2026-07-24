# Trusted Device Acknowledgement

## Purpose

The Account Security Center lets an authenticated customer explicitly trust the browser and network fingerprint used by the current active session. This reduces repeated new-device warnings without exposing raw network addresses, session tokens, or token hashes.

## Security model

- Trust is scoped to one `app_users.id`.
- The stored fingerprint is a SHA-256 digest derived inside PostgreSQL from the normalized session user-agent and the existing one-way IP hash.
- Raw IP addresses, cookies, session tokens, and token hashes are never returned to the browser or stored in the trusted-device table.
- The current session must still be active when trust is recorded.
- The operation is idempotent through `UNIQUE(user_id, fingerprint_hash)`.
- Trusting a device does not extend or recreate a session.
- Password recovery still revokes every session; trusted-device records remain account history and only influence familiarity scoring for future sessions with the same privacy-safe fingerprint.

## Data model

`account_trusted_devices` contains:

- `user_id`
- `fingerprint_hash`
- a bounded browser label
- `trusted_at`
- `last_seen_at`

The table is created idempotently under the existing account-security advisory lock, making API startup safe with multiple replicas.

## API

Authenticated customer route:

```http
POST /api/v1/customer/security/devices/trust-current
```

The Next.js customer proxy exposes the operation through:

```http
POST /api/customer/security
Content-Type: application/json

{"action":"trust_current_device"}
```

Responses are `no-store` and remain protected by the existing customer-session and same-origin boundary.

## Auditability

A successful acknowledgement writes the account-level security event:

```text
device.trusted
```

The event stores only the generated trusted-device UUID. It does not contain the fingerprint, IP information, user-agent, or session secret.

## Operational checks

After deployment:

1. Sign in from a browser that is shown as unfamiliar.
2. Open `/settings/security`.
3. Select **Trust this device** on the current session.
4. Refresh the page and confirm the session shows as trusted.
5. Confirm a `device.trusted` entry appears in Security activity.
6. Verify API and browser logs contain no raw IP, session token, token hash, or trusted fingerprint.

## Rollback

The feature can be rolled back at the application layer without deleting `account_trusted_devices`. The table is additive and does not change session validity or authentication behavior. A later controlled migration may remove it after verifying no deployed version reads it.
