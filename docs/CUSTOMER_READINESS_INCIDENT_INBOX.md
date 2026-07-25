# Customer Readiness Incident Inbox

## Purpose

The onboarding readiness center now includes a tenant-scoped operational inbox for durable production-readiness regressions. It uses the canonical readiness incident API and keeps the browser, scheduler, CLI, and PostgreSQL lifecycle aligned.

## Customer routes

```http
GET /api/customer/workspaces/:workspaceId/readiness-incidents?limit=50
```

```http
POST /api/customer/workspaces/:workspaceId/readiness-incidents/:incidentId/acknowledge
Content-Type: application/json

{ "note": "Investigating HubSpot connection regression" }
```

```http
POST /api/customer/workspaces/:workspaceId/readiness-incidents/:incidentId/resolve
Content-Type: application/json

{ "note": "Connection restored and sync verified" }
```

## Access model

- Every request validates the signed-in customer's membership in the requested workspace.
- Owners and admins can acknowledge or manually resolve incidents.
- Viewers can inspect the inbox but cannot mutate lifecycle state.
- The server-side proxy adds the internal API authentication header; the browser never receives it.
- Incident IDs and workspace IDs are URL encoded before forwarding.
- Mutation actions are allowlisted to `acknowledge` and `resolve`.

## UX behavior

- Readiness status, immutable evaluation history, and durable incidents load together for the selected company.
- Active incident count is visible at a glance.
- Each incident shows lifecycle state, score, blocker count, detection timestamps, occurrence count, and the latest operational note.
- Owners and admins can add a bounded note before acknowledgement or resolution.
- The existing workspace-change abort, 12-second browser timeout, 20-second upstream timeout, responsive layout, loading state, and error state remain in place.

## Privacy and safety

The UI and proxies do not expose notification recipients, email content, provider message IDs, OAuth tokens, CRM payloads, session data, IP addresses, database credentials, or provider credentials. Responses remain `no-store`.

## Operational guidance

Automatic recovery remains the preferred resolution path. Manual resolution is intended for exceptional cases where the underlying readiness state has recovered operationally but a durable incident requires explicit closure. Acknowledgement should be used when an owner or admin has accepted responsibility and investigation is underway.
