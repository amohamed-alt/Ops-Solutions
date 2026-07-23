# Data SLA incident monitoring

Ops Solutions can persist workspace reliability snapshots and maintain a durable incident lifecycle independently of the customer browser.

## Evaluate all workspaces

```bash
bash scripts/data-sla-monitor.sh --action evaluate
```

Default policy:

- warning when the newest mirrored CRM record is older than 90 minutes
- critical when freshness exceeds 24 hours
- critical when HubSpot is disconnected, no freshness timestamp exists, or the latest sync failed
- warning when webhook failures or pending semantic mappings exist

Override policy with bounded values:

```bash
bash scripts/data-sla-monitor.sh \
  --action evaluate \
  --warning-minutes 120 \
  --critical-minutes 2880
```

Evaluate one tenant only:

```bash
bash scripts/data-sla-monitor.sh \
  --action evaluate \
  --workspace-id <workspace-uuid>
```

## Incident status

```bash
bash scripts/data-sla-monitor.sh --action status
```

Every evaluation writes an immutable snapshot and upserts an incident by a stable fingerprint. Numeric counts and ages are normalized in the fingerprint, preventing a new incident from being created every time a counter changes.

Healthy evaluations automatically resolve active incidents for the workspace. Previously resolved fingerprints reopen when the same failure recurs.

## Acknowledge or resolve

```bash
bash scripts/data-sla-monitor.sh \
  --action acknowledge \
  --incident-id <incident-uuid> \
  --workspace-id <workspace-uuid> \
  --actor ops@example.com \
  --note "Owner investigating HubSpot authentication"
```

```bash
bash scripts/data-sla-monitor.sh \
  --action resolve \
  --incident-id <incident-uuid> \
  --workspace-id <workspace-uuid> \
  --actor ops@example.com \
  --note "OAuth reconnected and full reconciliation completed"
```

Always include `--workspace-id` for human-operated transitions. The SQL update remains parameterized and tenant scoped.

## Scheduling

A safe hourly cron entry on the VPS:

```cron
7 * * * * cd /root/Ops-Solutions && bash scripts/data-sla-monitor.sh --action evaluate >> /var/log/ops-data-sla.log 2>&1
```

The evaluator is safe with overlapping runs because incident identity is protected by a workspace/fingerprint unique constraint. For high availability, schedule from one operations node or wrap the command with `flock`.

## Data retained

`data_sla_snapshots` stores grade, breach labels, aggregate metrics, policy and check time. `data_sla_incidents` stores incident state, occurrence count, acknowledgement/resolution metadata and timestamps.

No HubSpot tokens, raw webhook bodies, CRM properties, report artifacts, passwords or database credentials are stored in these tables or printed by the CLI.

## Operations and retention

Snapshots are intentionally immutable for auditability. Add a retention job only after agreeing the contractual history window. A conservative starting point is 180 days for snapshots and indefinite retention for incident summaries.

## Rollback

The monitor is additive. To stop it, remove the scheduler entry. The tables can be retained safely. Destructive rollback requires an explicit database change and should only be performed after exporting incident history:

```sql
DROP TABLE IF EXISTS data_sla_snapshots;
DROP TABLE IF EXISTS data_sla_incidents;
```
