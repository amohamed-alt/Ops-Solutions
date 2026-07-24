# Device Familiarity Security

The Account Security Center now detects whether each active customer session resembles a previously observed device for the same account.

## Detection model

A session is considered familiar when an older session exists for the same user with the same normalized browser user-agent and the same one-way IP hash. The raw IP address, session token, and token hash are never returned to the browser.

Recent sessions without matching history are marked for review as **New device or browser**. This includes the current session, so a customer can immediately see that a login came from an unfamiliar environment.

Device familiarity is a risk signal, not a blocking authentication factor. It is combined with session age and inactivity:

- Current session on a familiar device: trusted.
- New device or browser created in the last seven days: review.
- Session inactive for 30 days or more: high risk.
- Session inactive for 14 days or older than 90 days: review.

## Privacy and tenant safety

- Detection is scoped to one `user_id`.
- Raw IP addresses are not stored; only the existing SHA-256 IP hash is compared.
- Session tokens and token hashes are not exposed by the API.
- The API returns only `familiarDevice`, a browser label, timestamps, and the existing opaque session identifier.
- No cross-user or cross-workspace comparison is performed.

## Operations

The schema bootstrap adds an idempotent index on `(user_id, user_agent, ip_hash, created_at DESC)` to keep familiarity checks efficient for accounts with many sessions. The schema remains protected by the existing transaction advisory lock so concurrent API replicas cannot race during startup.

This feature does not send email notifications or automatically revoke sessions. Those actions remain explicit to avoid false-positive lockouts. The next recommended extension is an opt-in new-device notification using the configured Resend or Postmark provider.
