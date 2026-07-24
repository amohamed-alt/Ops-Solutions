# Workspace Onboarding Readiness History

## Purpose

The API is now the single source of truth for workspace production readiness. It evaluates the same tenant-scoped evidence used by the operational CLI and can persist immutable snapshots for audit, support and onboarding handoff.

## Endpoints

All endpoints require the existing administrative API boundary and a valid workspace UUID.

### Live evaluation

```http
GET /api/v1/workspaces/:workspaceId/onboarding-readiness?freshnessHours=24
```

This endpoint is read-only and returns the current readiness report without creating history.

### Persisted evaluation

```http
POST /api/v1/workspaces/:workspaceId/onboarding-readiness/evaluate
Content-Type: application/json

{
  "freshnessHours": 24
}
```

This endpoint evaluates the workspace and stores an immutable snapshot. Snapshot writes are serialized per workspace with a PostgreSQL transaction advisory lock, preventing duplicate or incorrectly ordered transitions when multiple API replicas evaluate the same tenant concurrently.

### History

```http
GET /api/v1/workspaces/:workspaceId/onboarding-readiness/history?limit=30
GET /api/v1/workspaces/:workspaceId/onboarding-readiness/history?transitionsOnly=true
```

History is always filtered by `workspace_id`. The maximum response is 100 snapshots.

## Transition semantics

- The first snapshot has `previousReady = null` and `transitioned = false`.
- A later change from blocked to ready, or ready to blocked, sets `transitioned = true`.
- Warning-only changes do not produce a readiness transition when the boolean ready state stays unchanged.
- Snapshots are immutable and deleted automatically only when their workspace is deleted.

## Stored data

Snapshots contain readiness policy, sanitized check evidence, next actions, score, blocker and warning counts, and timestamps. They do not contain OAuth tokens, raw CRM payloads, customer property values, session credentials or database credentials.

## Production use

The web onboarding center should use the live endpoint for refreshes and the persisted evaluation endpoint when an owner or administrator explicitly re-evaluates onboarding. The history endpoint supports a timeline showing when a tenant became production-ready or regressed.

The schema is installed idempotently under `schema_migrations` and protected by a PostgreSQL advisory lock for multi-replica startup safety.
