# Production monitoring scheduler

Ops Solutions ships read-only and incident-producing operational checks for PostgreSQL backup freshness, data SLA evaluation, fleet-wide onboarding readiness, and multi-tenant integrity. This scheduler makes those checks durable on the production host instead of relying on manual execution.

## Install

Run from the deployed repository as root:

```bash
OPS_DEPLOY_PATH=/root/Ops-Solutions \
  bash scripts/install-ops-monitoring.sh
```

The installer creates one hardened systemd service template and four persistent timers:

- backup freshness: daily around 04:20 UTC
- data SLA evaluation: hourly around minute 07
- fleet onboarding readiness evaluation: hourly around minute 22
- tenant integrity audit: daily around 05:10 UTC

Randomized delays prevent every production host from starting checks at exactly the same second. Persistent timers catch up after downtime.

The readiness evaluation persists canonical server-side snapshots for every active workspace. A transition from `ready` to `blocked` is therefore retained in the onboarding readiness history and is visible in the customer readiness center. Per-workspace evaluation failures produce a warning exit code without stopping the remaining fleet evaluation.

## State

Latest sanitized results and bounded history are written to:

```text
/var/lib/ops-solutions/monitoring/
```

Each check stores an atomic `*-latest.json` file and a `*-history.jsonl` file. History is bounded to the latest 500 executions. No secrets, OAuth tokens, CRM record properties, report artifacts, passwords, or database connection strings are intentionally persisted.

Read status:

```bash
bash scripts/ops-monitoring-status.sh text
bash scripts/ops-monitoring-status.sh json
```

Exit codes are monitoring-friendly: `0` healthy, `2` warning, `3` critical or missing, and `4` configuration failure.

## Operations

```bash
systemctl list-timers 'ops-solutions-monitor-*'
systemctl status ops-solutions-monitor@backup.service
journalctl -u ops-solutions-monitor@readiness.service --since '24 hours ago'
systemctl start ops-solutions-monitor@readiness.service
systemctl start ops-solutions-monitor@integrity.service
```

The runner uses non-blocking `flock` locks, so overlapping executions exit safely. The readiness engine also uses a PostgreSQL advisory lock, protecting against overlap across hosts or manually-triggered evaluations. State publishing uses an atomic rename so readers never observe a partially written snapshot.

## Configuration

Optional environment variables can be added through a systemd drop-in:

```ini
[Service]
Environment=OPS_BACKUP_MAX_AGE_HOURS=26
Environment=OPS_TENANT_STALE_HOURS=24
Environment=OPS_MONITORING_LIMIT=100
Environment=OPS_READINESS_FRESHNESS_HOURS=24
Environment=OPS_READINESS_CONCURRENCY=3
Environment=OPS_READINESS_WORKSPACE_LIMIT=10000
```

Readiness limits are validated before execution:

- freshness: 1-168 hours
- concurrency: 1-10 workers
- workspace limit: 1-10,000 active workspaces

Then run:

```bash
systemctl daemon-reload
systemctl restart ops-solutions-monitor-readiness.timer
```

## Rollback

```bash
systemctl disable --now \
  ops-solutions-monitor-backup.timer \
  ops-solutions-monitor-sla.timer \
  ops-solutions-monitor-readiness.timer \
  ops-solutions-monitor-integrity.timer
rm -f /etc/systemd/system/ops-solutions-monitor@.service
rm -f /etc/systemd/system/ops-solutions-monitor-{backup,sla,readiness,integrity}.timer
systemctl daemon-reload
```

Removing units does not delete monitoring history. Remove `/var/lib/ops-solutions/monitoring` only after retaining any incident evidence required by operations.

## External alerts

The scheduler deliberately does not embed provider credentials. A monitoring agent can call `ops-monitoring-status.sh json`, inspect its exit code, or watch systemd unit failures. Configure PagerDuty, Better Stack, Uptime Kuma, or another provider outside the repository using secrets stored only on the production host.

Within the product, readiness transitions are already persisted. The next alerting layer should consume `ready -> blocked` transitions and repeated fleet evaluation failures from the canonical snapshot history rather than re-evaluating workspace state independently.
