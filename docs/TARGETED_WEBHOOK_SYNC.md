# Targeted HubSpot webhook synchronization

Webhook-sourced queue jobs update only the affected HubSpot records instead of running a workspace-wide incremental or full synchronization.

## Processing lifecycle

1. The API validates and journals the signed HubSpot batch.
2. The API queues one deduplicated workspace job for the batch window.
3. The worker atomically claims up to 500 `queued` or `failed` events with `FOR UPDATE SKIP LOCKED`.
4. Events move to `processing` before external API calls.
5. Events for the same object type and record ID are coalesced.
6. The worker fetches the current record with the discovered and approved mapped properties plus supported associations.
7. The PostgreSQL CRM mirror and outgoing associations are replaced transactionally.
8. Deleted records, and records returning HubSpot 404, are archived locally and their associations are removed.
9. Successful events become `completed`; failed events remain retryable as `failed`.

## Safety

- Claims and updates always include `workspace_id`.
- Browser input is not involved in webhook worker authorization.
- HubSpot access tokens remain encrypted at rest and are resolved only inside the worker.
- A targeted run does not advance the global incremental cursor, preventing one record from hiding other portal changes.
- Existing scheduled incremental and full reconciliation jobs remain unchanged and provide eventual reconciliation.
- Queue retries are idempotent because completed events are never reclaimed.

## Operational behavior

The worker records targeted operations in `sync_runs` with mode `targeted`. Job logs include `source: hubspot_webhook`, record counts, completed event counts and failures.

The webhook journal status lifecycle is:

```text
received -> queued -> processing -> completed
                           |-> failed -> processing
received -> ignored
```

The worker processes at most 500 events per job. Additional events remain queued for the next deduplicated webhook job or recovery run.

## Rollback

Reverting the worker integration restores workspace-wide webhook synchronization. The added `processing` and `completed` status values are backwards compatible and do not alter CRM records. The optional processing index can be dropped without data loss:

```sql
DROP INDEX IF EXISTS hubspot_webhook_events_processing_idx;
```
