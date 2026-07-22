# Smart SDR Analytics API

The analytics runtime executes the versioned SDR dashboard template against the tenant-isolated PostgreSQL CRM copy. HubSpot is not queried during dashboard requests.

## Security and tenancy

Every route requires `x-admin-key` during the bootstrap phase and resolves the workspace before executing SQL. Every generated query includes both `workspace_id` and `object_type` predicates.

## Dashboard payload

```http
GET /api/v1/workspaces/:workspaceId/analytics/sdr
```

The response contains:

- Versioned template metadata
- Sync freshness and total record count
- Mapping readiness for required and optional semantic fields
- KPI metrics with per-metric readiness status
- Calls-by-owner leaderboard with owner names and emails
- Available drill-down definitions

A missing semantic mapping does not fail the complete dashboard. The affected metric returns `status: configuration_required` and a precise error while independent metrics remain available.

## Single metric

```http
GET /api/v1/workspaces/:workspaceId/analytics/sdr/metrics/:metricKey
```

Supported metric keys are defined in `apps/api/src/templates/sdr-dashboard.js`.

## Priority-lead drill-down

```http
GET /api/v1/workspaces/:workspaceId/analytics/sdr/drilldowns/priority-leads-needing-action?limit=50&offset=0
```

Pagination is capped at 200 rows. Results expose the HubSpot record ID, selected properties, HubSpot timestamps and local synchronization timestamp.

## Current template metrics

- Portfolio Contacts
- Highest Priority Leads
- Untouched Leads
- Stale Leads
- Open Pipeline
- Deals at Risk
- Calls in the last 30 days
- Meetings in the last 30 days
- Calls by Owner

## Production behavior

- SQL identifiers are allowlisted by the analytics compiler.
- JSON property keys and filter values are parameterized.
- Aggregate values are returned as JSON numbers rather than PostgreSQL numeric strings.
- Owner IDs are resolved from the discovered owner directory.
- Archived CRM records are excluded by default.
- Dashboard requests remain functional when one optional mapping is incomplete.
