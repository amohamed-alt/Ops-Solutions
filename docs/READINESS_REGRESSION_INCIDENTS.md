# Readiness regression incidents

Ops Solutions records a durable operational incident when a workspace that was previously production-ready transitions back to blocked.

## Scope

The monitor consumes the canonical `onboarding_readiness_snapshots` history. It does not independently recalculate readiness and does not inspect CRM property values, OAuth tokens, session data, or customer payloads.

A first-time blocked workspace is onboarding work, not a regression, and does not create an incident. An incident is opened only when the latest snapshot has all of the following:

- `transitioned = true`
- `previous_ready = true`
- `ready = false`

When the latest snapshot becomes ready again, any open or acknowledged incident for that workspace is resolved automatically.

## Run

Evaluate the latest snapshot for up to 200 workspaces:

```bash
bash scripts/readiness-regression-monitor.sh \
  --action evaluate \
  --limit 200 \
  --cooldown-minutes 360
```

Inspect incidents:

```bash
bash scripts/readiness-regression-monitor.sh --action status --limit 200
```

Acknowledge an incident within a workspace boundary:

```bash
bash scripts/readiness-regression-monitor.sh \
  --action acknowledge \
  --incident-id <incident-uuid> \
  --workspace-id <workspace-uuid> \
  --actor ops@example.com \
  --note "Investigating the readiness regression"
```

Resolve manually only after validating recovery:

```bash
bash scripts/readiness-regression-monitor.sh \
  --action resolve \
  --incident-id <incident-uuid> \
  --workspace-id <workspace-uuid> \
  --actor ops@example.com \
  --note "Recovery verified"
```

## Lifecycle

```text
open -> acknowledged -> resolved
```

A later `ready -> blocked` transition reopens the same workspace incident and increments `occurrences`. PostgreSQL advisory transaction locks serialize lifecycle changes for each workspace across API replicas.

The evaluator returns `shouldNotify=true` only when the incident has not been notified before or the configured cooldown has elapsed. Delivery is intentionally separate from incident creation so provider outages cannot prevent durable incident persistence.

## Safety

- Every workspace-specific command validates UUID input.
- Incident transitions can be constrained by both incident ID and workspace ID.
- All SQL values are parameterized.
- The schema is idempotent and protected by a PostgreSQL advisory migration lock.
- Output contains readiness scores and counts, not CRM records, tokens, credentials, or raw customer data.
- No destructive repair or automatic HubSpot mutation is performed.

## Rollback

Stop scheduling or invoking `scripts/readiness-regression-monitor.sh`. Existing incident history can remain safely in PostgreSQL. Do not drop the table during an active incident response. If removal is approved later, back up PostgreSQL first and drop `readiness_regression_incidents` in a reviewed migration.
