# Readiness Incident Admin API

## Purpose

This API exposes the durable readiness regression incident lifecycle to workspace administrators without exposing notification recipients, email bodies, provider credentials, OAuth tokens, CRM payloads, session data, or raw delivery errors.

All routes require the existing admin authentication middleware and resolve the workspace through the shared workspace authorization boundary before reading or mutating an incident.

## Routes

### List incidents

```http
GET /api/v1/workspaces/:workspaceId/readiness-incidents?limit=25&status=active&severity=critical&minimumBlockers=1&sort=activity_desc
```

The limit defaults to 25 and is bounded between 1 and 50. Filtering, sorting, totals, and opaque cursor pagination are executed in PostgreSQL and scoped to the authorized workspace.

### Read one incident

```http
GET /api/v1/workspaces/:workspaceId/readiness-incidents/:incidentId
```

This route returns one operational incident record independent of the current list filters or loaded cursor pages. It is intended for deep links and dead-letter correlation. The lookup requires both `workspace_id` and `incident_id`, returns `404 readiness_incident_not_found` when the incident is absent from the authorized workspace, and rejects malformed identifiers before SQL execution.

### Acknowledge an incident

```http
POST /api/v1/workspaces/:workspaceId/readiness-incidents/:incidentId/acknowledge
Content-Type: application/json

{
  "note": "Investigating HubSpot connection regression"
}
```

Acknowledgement records the authenticated admin actor, timestamp, and an optional bounded note.

### Resolve an incident manually

```http
POST /api/v1/workspaces/:workspaceId/readiness-incidents/:incidentId/resolve
Content-Type: application/json

{
  "note": "Connection restored and initial sync verified"
}
```

Automatic recovery remains the preferred path. Manual resolution is available for operational exceptions and remains workspace-scoped.

## Security properties

- Admin authentication is required on every route.
- Workspace authorization is resolved before incident access.
- Reads and mutations use both `workspace_id` and `incident_id`.
- Invalid UUIDs are rejected before SQL execution.
- List size is bounded to prevent unbounded responses.
- Responses contain operational metadata only.
- No new secrets, HubSpot scopes, billing accounts, or external dependencies are required.

## Operational behavior

The API reuses the same PostgreSQL-backed incident engine used by scheduled monitoring. Detail reads, acknowledgement, and resolution therefore remain consistent across the UI, CLI, scheduler, and multiple API replicas.

The detail route removes a cursor-pagination limitation: a failed delivery can navigate to its incident even when that incident is not present in the currently loaded page or is excluded by active list filters.
