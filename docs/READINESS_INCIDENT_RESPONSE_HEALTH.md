# Readiness incident response health

The customer Readiness Center now provides an operational response summary above the incident inbox.

## Signals

The summary is calculated only from the tenant-scoped incident records currently loaded in the browser:

- **Active:** open or acknowledged incidents.
- **Critical:** active incidents with `severity=critical`.
- **Acknowledgement SLA:** open incidents older than four hours.
- **Resolution SLA:** active incidents older than 24 hours.
- **Notification coverage:** active incidents without a recorded successful `lastNotifiedAt` value.

The UI deliberately labels this as a loaded-page summary. It does not claim fleet-wide completeness when additional opaque cursor pages remain.

## Security and isolation

- No new API routes, credentials, scopes or data stores are introduced.
- The summary uses only records returned by the existing tenant-scoped readiness incident API.
- No recipients, email bodies, provider identifiers, OAuth tokens, CRM payloads, sessions or IP data are rendered.
- Workspace switching continues to cancel stale requests and clears cross-workspace incident context.

## Operations

An `Attention required` state means at least one loaded active incident has breached acknowledgement or resolution SLA, or has no recorded successful notification. Operators should open the incident inbox, acknowledge ownership, add a concise operational note and resolve only after the readiness blockers are remediated.

## Rollback

Revert the feature commit. No schema migration, persisted state or background worker change is involved.
