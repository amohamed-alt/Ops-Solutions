# Analytics performance maintenance

The HubSpot reporting layer now creates a focused set of workspace-scoped PostgreSQL indexes after the CRM mirror schema is available.

## Covered access patterns

- active records by workspace, object type and creation/sync time
- owner filters across contacts, activities and deals
- contact country and lead-source filters
- deal pipeline, stage and close-date reporting
- activity timestamp windows for calls, meetings and tasks
- reverse association lookups used to apply contact dimensions to deals and activities

The indexes are additive and use `CREATE INDEX IF NOT EXISTS`. They do not alter CRM records or HubSpot data.

## Planner statistics

The worker acquires a Redis interval lock and runs `ANALYZE` for `crm_records`, `crm_record_associations` and `sync_runs` at most once every six hours across all worker instances. The lock is removed when maintenance fails so a later attempt can recover.

## Operations

Structured worker events:

- `analytics_index_ready`
- `analytics_planner_maintenance_completed`
- `analytics_planner_maintenance_failed`

Index creation happens during worker startup after `ensureSyncSchema`. A failed index build prevents the worker from declaring itself ready, which keeps production from serving a partially initialized synchronization worker.

## Rollback

The indexes can be dropped independently without data loss. Planner maintenance can be disabled by reverting the worker integration; no environment variable or secret is required.
