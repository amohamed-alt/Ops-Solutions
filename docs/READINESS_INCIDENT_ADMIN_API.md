# Readiness Incident Admin API

## Purpose

This API exposes the durable readiness regression incident lifecycle to workspace administrators without exposing notification recipients, email bodies, provider credentials, OAuth tokens, CRM payloads, session data, or raw delivery errors.

All routes require the existing admin authentication middleware and resolve the workspace through the shared workspace authorization boundary before reading or mutating an incident.

## Routes

### List incidents

```http
GET /api/v1/workspaces/:workspaceId/readiness-incidents?limit=50
```

The limit defaults to 50 and is bounded between 1 and 200. Results are scoped to the authorized workspace and ordered by the durable incident engine.

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
- Mutations use both `workspace_id` and `incident_id`.
- Invalid UUIDs are rejected by the incident engine before SQL execution.
- List size is bounded to prevent unbounded responses.
- Responses contain operational metadata only.
- No new secrets, HubSpot scopes, billing accounts, or external dependencies are required.

## Operational behavior

The API reuses the same PostgreSQL-backed incident engine used by scheduled monitoring. Acknowledgement and resolution therefore remain consistent across the UI, CLI, scheduler, and multiple API replicas.
