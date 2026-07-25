# Readiness incident snapshot idempotency

The readiness regression monitor is executed repeatedly by the production scheduler. A canonical onboarding readiness snapshot must therefore affect the incident lifecycle at most once.

## Correct behavior

- A new `ready -> blocked` snapshot opens or reopens the workspace incident and increments `occurrences` once.
- Reprocessing the same snapshot returns `action=unchanged`.
- Reprocessing does not increment `occurrences`.
- Reprocessing does not emit another notification candidate.
- A later, distinct `ready -> blocked` snapshot can increment the incident again.
- A recovery snapshot still resolves an open or acknowledged incident automatically.

## Database guarantee

The incident upsert uses the workspace uniqueness boundary and adds this conflict-update predicate:

```sql
WHERE readiness_regression_incidents.latest_snapshot_id
      IS DISTINCT FROM EXCLUDED.latest_snapshot_id
```

PostgreSQL therefore skips the update when the scheduler presents the same snapshot again. The monitor then reloads the existing incident inside the same workspace advisory-lock transaction and returns it unchanged.

This guard is database-enforced rather than process-memory based, so it remains correct across retries, API restarts, multiple replicas, manual invocations, and overlapping hosts.

## Operational impact

Before this fix, an unchanged latest transition snapshot could increase `occurrences` during every hourly monitor run and repeatedly become eligible for notification cooldown logic. After this fix, occurrence counts represent distinct readiness regressions rather than scheduler executions.

No schema migration, credentials, HubSpot scopes, CRM payload changes, or destructive remediation are introduced.
