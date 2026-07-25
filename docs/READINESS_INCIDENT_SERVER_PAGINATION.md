# Readiness Incident Server-side Pagination

## Purpose

The readiness incident API now performs filtering, sorting, counting, and pagination inside PostgreSQL instead of requiring the customer browser to load a large bounded history and process it locally.

## Endpoint

```http
GET /api/v1/workspaces/:workspaceId/readiness-incidents
```

Supported query parameters:

- `status`: `all`, `active`, `open`, `acknowledged`, or `resolved`.
- `severity`: `all`, `warning`, or `critical`.
- `minimumBlockers`: integer from 0 through 999.
- `sort`: `activity_desc`, `activity_asc`, `blockers_desc`, `score_asc`, or `occurrences_desc`.
- `limit`: integer from 1 through 50; defaults to 25.
- `cursor`: opaque cursor returned by the preceding response.

Example response:

```json
{
  "results": [],
  "total": 0,
  "filters": {
    "status": "active",
    "severity": "all",
    "minimumBlockers": 1,
    "sort": "activity_desc"
  },
  "pageInfo": {
    "limit": 25,
    "offset": 0,
    "hasNextPage": false,
    "nextCursor": null
  }
}
```

## Safety properties

- Workspace membership is resolved before the query engine receives a workspace identifier.
- Every SQL query includes `i.workspace_id = $1`.
- User filter values are bound parameters or mapped through fixed server-side allowlists.
- Page size is capped at 50 and cursor offsets are capped at 1,000,000.
- Cursors are tied to the originating filter and sort fingerprint; changing filters invalidates the cursor.
- The customer proxy independently allowlists and bounds every forwarded parameter.
- Responses remain `no-store` and the upstream request has a 20-second timeout.
- No recipients, email bodies, OAuth tokens, CRM payloads, credentials, session data, or IP data are added.

## Compatibility

Requests that only provide `limit` continue to work. The response still contains `results`, with additional `total`, `filters`, and `pageInfo` fields. Existing acknowledge and resolve routes are unchanged.

## Rollback

Revert the feature commit. No destructive migration or external dependency is introduced. The query engine is read-only and uses the existing readiness incident and snapshot tables.
