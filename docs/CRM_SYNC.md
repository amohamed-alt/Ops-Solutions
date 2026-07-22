# HubSpot CRM Sync Engine

## Purpose

The sync worker maintains a tenant-isolated analytics copy of HubSpot CRM records. Dashboards query PostgreSQL instead of calling HubSpot during every page load.

## Supported objects

The default object set is:

- contacts
- companies
- deals
- calls
- meetings
- tasks

The list can be changed with `HUBSPOT_SYNC_OBJECTS`.

## Sync modes

### Initial sync

Runs when a connected workspace has no successful cursor. It reads all accessible records with cursor pagination and stores selected standard properties, approved semantic properties, raw payloads and returned associations.

### Incremental sync

Runs every 15 minutes by default. It searches by `hs_lastmodifieddate` with a five-minute overlap to avoid missing records around cursor boundaries. Upserts make repeated pages idempotent.

### Full reconciliation

Runs every 24 hours by default, even when incremental synchronization is healthy. It repairs missed webhook/search events and refreshes associations.

## Property selection

The worker does not request every HubSpot property. It requests:

1. A controlled set of operational properties for each object type.
2. Any property approved through semantic mapping.
3. Only properties confirmed by portal discovery.

This controls URL size, storage usage and API consumption.

## Persistence

The worker creates and maintains:

- `crm_records`
- `crm_record_associations`
- `sync_runs`
- `sync_cursors`

Every row is scoped by `workspace_id`.

## Reliability controls

- BullMQ retries failed jobs four times with exponential backoff.
- HubSpot `429` and `5xx` responses use bounded retries.
- OAuth access tokens refresh automatically.
- Writes use PostgreSQL upserts and page-level transactions.
- Each sync run records completed, skipped and failed object types.
- Optional activity objects are skipped when the installed portal lacks their scope.
- Worker concurrency is one to protect the current VPS and HubSpot rate limits.

## Scheduler defaults

```env
SYNC_SCHEDULER_INTERVAL_MS=300000
SYNC_INCREMENTAL_INTERVAL_MINUTES=15
SYNC_FULL_RECONCILIATION_HOURS=24
SYNC_MAX_PAGES_PER_RUN=500
```

## Monitoring

Worker health:

```bash
cat /tmp/worker-heartbeat
```

Container status:

```bash
docker compose -f docker-compose.prod.yml ps worker
```

Recent sync runs:

```sql
SELECT workspace_id, mode, status, summary, error, started_at, completed_at
FROM sync_runs
ORDER BY started_at DESC
LIMIT 20;
```

Failed jobs remain in Redis for seven days by default.

## Current limitations

- HubSpot webhooks are not yet wired; scheduled incremental sync is the source of freshness.
- Archived/deleted records need a dedicated deletion reconciliation pass.
- Incremental searches approaching HubSpot's search-result ceiling must fall back to full reconciliation.
- Association changes are fully refreshed during full sync; incremental association refresh will be added with webhooks/batch reads.

## Next production additions

1. HubSpot webhook signature validation and event ingestion.
2. Archived record reconciliation.
3. Queue and sync health endpoints in the admin UI.
4. Per-portal API usage metrics.
5. Dead-letter recovery actions.
