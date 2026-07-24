# Account Security Center

## Purpose

The customer Account Security Center lets every signed-in user inspect active sessions and revoke access without operator intervention. It is account-scoped rather than workspace-scoped because one user can belong to multiple isolated companies while sharing one authentication identity.

## Customer workflow

Open `/settings/security` to:

- identify the current browser session
- review up to 50 active sessions ordered by recent activity
- revoke one non-current session
- revoke every other active session in one operation
- review the 30 most recent account-security events
- start the existing password recovery flow

The current session cannot be revoked through the single-session endpoint. This prevents accidental self-lockout; the normal Sign out control remains available.

## Security boundary

- Every API operation requires a valid, unexpired customer session.
- Session mutations are scoped to the authenticated `user_id`.
- The browser receives a second-order SHA-256 session identifier, never the stored token hash.
- Session token hashes, IP hashes, cookies, passwords, and raw user-agent strings are not returned.
- Revocation queries require both the authenticated user and opaque session identifier.
- The current token hash is explicitly excluded from individual and bulk revocation.
- Customer mutation requests remain protected by the platform same-origin/CSRF boundary.
- Responses are non-cacheable.

## Database

`account_security_events` stores bounded account-level audit metadata. It does not contain session tokens, passwords, email content, IP addresses, or CRM data.

The schema is created idempotently during route registration. Removing the feature can safely leave the audit table in place; it has no effect on authentication or workspace records.

## Operations

No new environment variables, dependencies, HubSpot scopes, or external providers are required.

If session revocation fails:

1. Verify API and PostgreSQL health.
2. Confirm the user still has an active current session.
3. Review API logs using the request ID, without logging headers or cookies.
4. Use the existing server-side session-security CLI only for emergency operator remediation.

## Backlog

- Optional email notification after high-risk session revocation.
- Device naming supplied by the customer.
- MFA and recovery codes after a product/legal decision on supported factors.
