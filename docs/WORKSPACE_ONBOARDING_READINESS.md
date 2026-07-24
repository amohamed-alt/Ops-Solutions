# Workspace Onboarding Readiness Gate

This gate provides a deterministic, tenant-scoped answer to a critical production question: **is this company workspace operationally ready?**

It is intentionally read-only. It never changes HubSpot, mappings, memberships, synchronized records, or workspace status.

## Checks

A workspace is considered ready only when no blocking checks remain.

| Check | Blocking rule |
| --- | --- |
| Workspace lifecycle | Workspace must be `active`. |
| HubSpot OAuth | A portal must be connected and connection status must be `connected`. |
| Schema discovery | Contacts, companies, and deals must have discovered properties and a discovery timestamp. |
| Semantic mappings | At least one approved semantic mapping must exist. |
| Initial synchronization | Latest sync must be completed and the tenant mirror must contain records. |
| Data freshness | Missing freshness blocks readiness; stale data produces a warning. |
| Ownership | At least one workspace owner must exist. |
| Auditability | Missing audit history produces a warning. |

Warnings reduce the readiness score but do not hide completed onboarding. Blockers always set `ready=false`.

## Production usage

```bash
bash scripts/workspace-onboarding-readiness.sh \
  --workspace 11111111-1111-4111-8111-111111111111 \
  --format text \
  --freshness-hours 24
```

JSON output for automation:

```bash
bash scripts/workspace-onboarding-readiness.sh \
  --workspace 11111111-1111-4111-8111-111111111111 \
  --format json > /tmp/workspace-readiness.json
```

The wrapper executes inside the production API container and reuses the existing database configuration without printing it.

## Exit codes

- `0`: no onboarding blockers remain.
- `2`: onboarding is incomplete, or only warnings remain.
- `4`: invalid input, missing runtime configuration, container failure, or database execution failure.

A warning-only report returns `2` so CI/CD and operational automation must make an explicit decision instead of silently treating degraded freshness as fully healthy.

## Security and tenant isolation

- Every operational query is parameterized with `workspace_id=$1` or the equivalent workspace primary-key filter.
- The evaluator returns aggregate counts and timestamps only.
- It does not return CRM payloads, property values, OAuth tokens, session tokens, password data, raw IP addresses, or database credentials.
- It does not call HubSpot APIs and cannot mutate customer CRM data.
- Invalid workspace identifiers are rejected before any SQL is issued.

## Recommended workflow

1. Create the company workspace and confirm an owner exists.
2. Complete HubSpot OAuth.
3. Run portal discovery.
4. Approve required semantic mappings.
5. Run the initial sync.
6. Execute this gate and resolve every blocker.
7. Re-run the gate before marking onboarding complete or handing the workspace to the customer.

## Next integration

The same evaluator is designed to be reused by a customer-facing Onboarding Readiness Center and by fleet-level operational monitoring. The UI should display the returned checks and actions without duplicating readiness logic in the browser.
