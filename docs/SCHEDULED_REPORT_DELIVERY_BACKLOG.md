# Scheduled report delivery backlog

The scheduling, export generation, execution history, tenant authorization, timezone handling, duplicate prevention, retries, pause/resume controls, and customer management UI are implemented.

Email delivery is intentionally deferred until a provider account is selected. The provider adapter must support:

- SMTP, Postmark, Resend, or another approved provider behind one interface
- secrets loaded only from production environment variables
- recipient validation and provider suppression handling
- idempotency using the scheduled execution ID
- retry classification for transient versus permanent failures
- attachment size enforcement
- summary-only and attachment delivery modes
- delivery event history without storing message bodies or credentials
- unsubscribe or schedule-disable links that require authenticated authorization

This is an external configuration and commercial decision. No provider credentials should be requested, printed, or committed during implementation.
