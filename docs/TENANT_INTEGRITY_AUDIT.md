# Tenant Integrity Audit

The tenant integrity audit is a read-only production diagnostic for the Ops Solutions multi-company data model. It detects conditions that could indicate broken workspace isolation, incomplete cleanup, stuck background processing, or configuration drift.

## Run the fleet audit

```bash
scripts/audit-tenant-integrity.sh --format text
```

Machine-readable output:

```bash
scripts/audit-tenant-integrity.sh --format json
```

Audit one company only:

```bash
scripts/audit-tenant-integrity.sh \
  --workspace 00000000-0000-4000-8000-000000000000 \
  --stale-hours 24 \
  --limit 100 \
  --format json
```

## Exit codes

- `0`: healthy; no critical or warning findings
- `2`: degraded; one or more warning findings
- `3`: critical; critical finding or failed check
- `4`: invalid configuration, missing runtime dependency, or CLI failure

The distinct exit codes make the command suitable for cron, systemd timers, health checks, or external monitoring.

## Checks

The audit currently verifies:

- a HubSpot portal is not connected to multiple workspaces
- every active workspace retains an owner
- memberships reference valid users and workspaces
- CRM records reference valid workspaces
- CRM associations retain a source record inside the same workspace
- webhook events are not stuck in `processing`
- synchronization runs are not stuck in `running`
- approved semantic mappings still reference discovered HubSpot properties
- export jobs retain valid user and workspace ownership

Tables belonging to features that are not installed yet are reported as `not_applicable`, not as a production failure.

## Security boundaries

- The audit performs `SELECT` statements only.
- Every tenant-owned check accepts an explicit workspace scope.
- SQL parameters are bound, never interpolated.
- Output excludes raw CRM payloads, properties, credentials, password hashes, tokens, email artifacts, and export bytes.
- Results contain bounded identifiers and operational metadata only.
- The command never repairs, deletes, reassigns, or archives data automatically.

## Recommended schedule

Run the fleet audit every hour and alert on exit code `2` or `3`. Keep only the JSON result and command exit status in monitoring; do not upload database dumps or application environment files.

Example cron entry:

```cron
17 * * * * cd /root/Ops-Solutions && scripts/audit-tenant-integrity.sh --format json >> /var/log/ops-tenant-integrity.log 2>&1
```

Use log rotation and ensure the log remains readable only by the deployment administrator.

## Responding to findings

1. Run the same audit with `--workspace` when a specific workspace is reported.
2. Confirm the database backup freshness check is healthy before any manual repair.
3. Review the relevant workspace audit trail and sync/webhook operations.
4. Prefer existing recovery controls: rediscovery, targeted webhook retry, incremental sync, or full reconciliation.
5. Make direct database changes only with a reviewed migration or documented incident procedure.

The audit intentionally does not auto-repair because ownership, portal reassignment, and data deletion can be irreversible business decisions.
