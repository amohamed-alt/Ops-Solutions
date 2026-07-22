# Background report exports

Large report generation is separated from the request lifecycle through the `report-exports` BullMQ queue.

## Lifecycle

1. An authenticated workspace member submits a CSV export request.
2. The API snapshots the validated reporting filters or resolves the requesting user's saved view.
3. A tenant- and user-scoped row is created in `report_export_jobs` and a BullMQ job is queued.
4. The API background worker generates the report with the existing parameterized revenue-reporting layer.
5. The artifact is stored as a bounded PostgreSQL `BYTEA` value and expires after 24 hours.
6. Status and download endpoints require the same user and workspace membership that created the export.

## Customer API

- `POST /api/v1/customer/workspaces/:workspaceId/exports`
- `GET /api/v1/customer/workspaces/:workspaceId/exports`
- `GET /api/v1/customer/workspaces/:workspaceId/exports/:exportId`
- `GET /api/v1/customer/workspaces/:workspaceId/exports/:exportId/download`

The request body accepts `format: "csv"`, an optional `savedViewId`, or a validated `filters` object. XLSX and PDF are reserved by the schema but intentionally rejected until their renderers are implemented.

## Reliability and security

- three attempts with exponential backoff
- idempotent completed-job handling
- ten queued exports per user and workspace per hour
- five-megabyte artifact ceiling inherited from the CSV renderer
- 24-hour artifact expiry and lazy cleanup
- no admin key in customer requests
- audit events for queueing and downloading
- no artifact bytes in status/list responses
- database lookups always include export ID, workspace ID and requesting user ID

## Rollback

Migration 3 can be reversed with:

```sql
DROP TABLE IF EXISTS report_export_jobs;
```

Disable queue processing by reverting `registerBackgroundExportRoutes` from the API startup lifecycle before rolling back the table.
