# Production monitoring scheduler

Ops Solutions ships read-only and incident-producing operational checks for PostgreSQL backup freshness, data SLA evaluation, and multi-tenant integrity. This scheduler makes those checks durable on the production host instead of relying on manual execution.

## Install

Run from the deployed repository as root:

```bash
OPS_DEPLOY_PATH=/root/Ops-Solutions \
  bash scripts/install-ops-monitoring.sh
```

The installer creates one hardened systemd service template and three persistent timers:

- backup freshness: daily around 04:20 UTC
- data SLA evaluation: hourly around minute 07
- tenant integrity audit: daily around 05:10 UTC

Randomized delays prevent every production host from starting checks at exactly the same second. Persistent timers catch up after downtime.

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
journalctl -u ops-solutions-monitor@sla.service --since '24 hours ago'
systemctl start ops-solutions-monitor@integrity.service
```

The runner uses non-blocking `flock` locks, so overlapping executions exit safely. State publishing uses an atomic rename so readers never observe a partially written snapshot.

## Configuration

Optional environment variables can be added through a systemd drop-in:

```ini
[Service]
Environment=OPS_BACKUP_MAX_AGE_HOURS=26
Environment=OPS_TENANT_STALE_HOURS=24
Environment=OPS_MONITORING_LIMIT=100
```

Then run:

```bash
systemctl daemon-reload
```

## Rollback

```bash
systemctl disable --now \
  ops-solutions-monitor-backup.timer \
  ops-solutions-monitor-sla.timer \
  ops-solutions-monitor-integrity.timer
rm -f /etc/systemd/system/ops-solutions-monitor@.service
rm -f /etc/systemd/system/ops-solutions-monitor-{backup,sla,integrity}.timer
systemctl daemon-reload
```

Removing units does not delete monitoring history. Remove `/var/lib/ops-solutions/monitoring` only after retaining any incident evidence required by operations.

## External alerts

The scheduler deliberately does not embed provider credentials. A monitoring agent can call `ops-monitoring-status.sh json`, inspect its exit code, or watch systemd unit failures. Configure PagerDuty, Better Stack, Uptime Kuma, or another provider outside the repository using secrets stored only on the production host.
