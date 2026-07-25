# Readiness Dead-letter Health Monitoring

## Purpose

Readiness regression and recovery notifications are retried by the durable delivery worker. Deliveries that remain failed after five attempts are dead letters and require operator review. This monitor makes that condition visible in the platform-wide operational status instead of leaving exhausted deliveries discoverable only through a manual database operation.

## Schedule

The production installer creates `ops-solutions-monitor-readiness-dead-letters.timer`. It runs hourly at minute 57 with up to three minutes of randomized delay, after readiness evaluation, incident creation, and notification delivery.

The check is protected by the standard host-level `flock` boundary and writes an atomic latest-state record plus bounded history under the configured monitoring state directory.

## Health policy

The monitor only persists aggregate counts and age information. It does not persist recipients, email bodies, provider credentials, OAuth tokens, CRM payloads, sessions, raw database rows, or delivery error text.

Default policy:

- `healthy`: no exhausted delivery exists.
- `warning`: one or more exhausted deliveries exist, but the oldest is younger than the SLA and the fleet count is below the critical threshold.
- `critical`: the oldest exhausted delivery is at least 24 hours old, its age cannot be determined safely, or at least 10 exhausted deliveries exist.

Configuration:

```text
OPS_READINESS_DEAD_LETTER_SLA_HOURS=24
OPS_READINESS_DEAD_LETTER_CRITICAL_COUNT=10
```

Allowed ranges:

- SLA: 1 to 720 hours.
- Critical count: 1 to 10,000 deliveries.

## Manual execution

```bash
bash scripts/readiness-delivery-dead-letter-health.sh
```

The command returns JSON and exits with:

- `0` healthy
- `2` warning
- `3` critical
- `4` execution or configuration failure

Run through the monitoring state pipeline:

```bash
bash scripts/run-ops-monitoring-check.sh readiness-dead-letters
bash scripts/ops-monitoring-status.sh text
```

## Investigation and remediation

List exhausted deliveries without exposing message content or recipients:

```bash
bash scripts/readiness-delivery-dead-letter.sh --action status --limit 100
```

Review the workspace, incident, snapshot, notification kind, attempts, timestamps, and sanitized error. Requeue only an exact reviewed delivery. The operation is dry-run by default:

```bash
bash scripts/readiness-delivery-dead-letter.sh \
  --action requeue \
  --workspace <workspace-uuid> \
  --delivery <delivery-uuid>
```

Apply only after the underlying provider, configuration, or recipient issue has been corrected:

```bash
bash scripts/readiness-delivery-dead-letter.sh \
  --action requeue \
  --workspace <workspace-uuid> \
  --delivery <delivery-uuid> \
  --apply
```

There is intentionally no bulk requeue action.

## Deployment

After deployment, reinstall or refresh the systemd units:

```bash
sudo bash scripts/install-ops-monitoring.sh
systemctl status ops-solutions-monitor-readiness-dead-letters.timer --no-pager
systemctl list-timers 'ops-solutions-monitor-*' --no-pager
```

The installer does not require new secrets or external accounts.

## Rollback

Disable the timer without modifying delivery data:

```bash
sudo systemctl disable --now ops-solutions-monitor-readiness-dead-letters.timer
```

Existing dead-letter inspection and exact-delivery requeue operations remain available.
