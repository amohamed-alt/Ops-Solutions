# HubSpot webhook recovery

The webhook journal is intentionally durable: failed or unprocessed events remain available for diagnosis instead of being deleted. Production operators can inspect and safely replay them from inside the API container without exposing database, Redis, HubSpot, or application secrets.

## Fleet health

Use the read-only fleet action before inspecting individual companies:

```bash
scripts/recover-webhooks.sh \
  --action fleet
```

It returns every active workspace with:

- HubSpot OAuth connection state
- portal ID
- webhook totals by state
- latest received and processed webhook timestamps
- latest synchronized CRM-record timestamp
- an operational classification: `healthy`, `degraded`, `pending`, `stale`, `no_webhooks`, or `disconnected`

Show only companies that need attention and customize the freshness threshold:

```bash
scripts/recover-webhooks.sh \
  --action fleet \
  --only-unhealthy \
  --stale-hours 12
```

The threshold is bounded from 1 to 720 hours. Fleet diagnostics are aggregate-only and never print raw webhook payloads, tokens, credentials, or customer record properties. Event and CRM counts are calculated in independent CTEs to avoid join multiplication on large portals.

## Workspace status

```bash
scripts/recover-webhooks.sh \
  --action status \
  --workspace 5839ad18-0d29-4e1b-aa51-47a0b9756aad
```

The response contains total, failed, pending, queued and ignored counts plus the latest received and processed timestamps.

## List events

```bash
scripts/recover-webhooks.sh \
  --action list \
  --workspace 5839ad18-0d29-4e1b-aa51-47a0b9756aad \
  --status failed \
  --limit 50
```

Only event metadata is printed. Raw webhook payloads, OAuth tokens and credentials are never emitted.

## Dry-run a replay

```bash
scripts/recover-webhooks.sh \
  --action retry \
  --workspace 5839ad18-0d29-4e1b-aa51-47a0b9756aad \
  --limit 100 \
  --dry-run
```

Without explicit event IDs, retry selects the oldest `failed` or `received` events from the last seven days, bounded to 100 records. Property changes and creations use incremental synchronization. Deletions and association changes escalate to a full reconciliation.

## Retry selected events

```bash
scripts/recover-webhooks.sh \
  --action retry \
  --workspace 5839ad18-0d29-4e1b-aa51-47a0b9756aad \
  --event 35fc3b20-90d7-4d26-9ad1-23e8c02572c1
```

A retry queues one BullMQ synchronization job and marks only the selected workspace-scoped events as queued. The HubSpot connection must still be connected.

## Ignore irrecoverable events

```bash
scripts/recover-webhooks.sh \
  --action ignore \
  --workspace 5839ad18-0d29-4e1b-aa51-47a0b9756aad \
  --event 35fc3b20-90d7-4d26-9ad1-23e8c02572c1 \
  --dry-run
```

Remove `--dry-run` only after confirming the event should not be replayed. Ignore does not delete the journal row; it changes the event state to preserve auditability.

## Safety boundaries

- Fleet health is read-only.
- Mutating actions require a valid workspace UUID.
- Every event query includes `workspace_id`.
- At most 100 events are selected in one automatic recovery.
- Duplicate event IDs are collapsed.
- Retry uses the existing queue retry/backoff policy.
- No production CRM records are deleted.
- The wrapper runs inside the existing API container and inherits secrets without printing them.

## Rollback

Revert the fleet-health commits to restore the workspace-only CLI. No database migration or persistent data change is required.
