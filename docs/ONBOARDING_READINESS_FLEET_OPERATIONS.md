# Onboarding Readiness Fleet Operations

This runbook covers durable, tenant-safe evaluation and retention of onboarding readiness snapshots across the SaaS fleet.

## Evaluate every active workspace

```bash
bash scripts/onboarding-readiness-operations.sh \
  --action evaluate \
  --format json \
  --concurrency 3 \
  --freshness-hours 24
```

The evaluator:

- selects active workspaces only;
- records an immutable snapshot using the canonical readiness engine;
- uses `trigger_source=system`;
- isolates failures so one broken tenant does not stop the fleet run;
- bounds concurrency between 1 and 10;
- holds a PostgreSQL advisory lock so two fleet runs cannot overlap;
- returns only workspace identifiers, names, scores, counts, snapshot identifiers, and safe error categories.

A successful run can still report individual workspace failures. The CLI exits with code `2` when one or more evaluations fail, allowing monitoring to alert without losing successful snapshots.

## Preview retention cleanup

```bash
bash scripts/onboarding-readiness-operations.sh \
  --action prune \
  --format json \
  --retention-days 180 \
  --minimum-snapshots 30 \
  --dry-run
```

Apply only after reviewing the preview:

```bash
bash scripts/onboarding-readiness-operations.sh \
  --action prune \
  --format json \
  --retention-days 180 \
  --minimum-snapshots 30 \
  --apply
```

Retention cleanup always preserves:

- every transition snapshot;
- the newest configured number of snapshots for each workspace;
- all snapshots newer than the retention threshold.

Use `--workspace <uuid>` to scope cleanup to one tenant during incident response or validation.

## Scheduling recommendation

Run fleet evaluation hourly after the sync workers' normal completion window. Run retention cleanup weekly in `--dry-run` mode, alert on unexpectedly large candidate counts, and apply during a controlled operations window.

Do not place database credentials, HubSpot tokens, or provider keys in systemd unit files. The wrapper uses the existing production container environment when Docker Compose is available.

## Exit codes

- `0`: operation completed, or another evaluator already holds the fleet lock.
- `2`: fleet evaluation completed with one or more tenant failures.
- `4`: invalid arguments, database failure, or unexpected execution error.

## Rollback

The feature introduces no new schema. Rollback consists of removing the scheduler invocation and reverting the application commit. Existing readiness snapshots remain valid and readable.
