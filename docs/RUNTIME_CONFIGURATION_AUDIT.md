# Runtime Configuration Audit

The runtime configuration audit detects production configuration drift without printing secret values.

## What it checks

- every key documented in `.env.example` exists in the selected runtime environment file
- every variable referenced by Docker Compose is configured
- duplicate and malformed `.env` entries
- placeholder or empty required values
- unsafe file permissions
- invalid URL schemes
- invalid boolean values
- short sensitive values
- dangerous production flags such as `DISABLE_AUTH=true`, `DEMO_MODE=true`, or `NODE_ENV=development`
- undocumented runtime keys that are absent from both the template and Compose files

The output contains key names, finding codes, and remediation messages only. It never returns configuration values.

## Run on the production server

```bash
cd /root/Ops-Solutions
bash scripts/audit-runtime-config.sh text
```

Machine-readable output:

```bash
bash scripts/audit-runtime-config.sh json
```

Use a different environment file without copying it into the repository:

```bash
OPS_ENV_FILE=/secure/path/ops.env bash scripts/audit-runtime-config.sh json
```

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Healthy |
| `2` | Warning-level drift |
| `3` | Critical or unsafe configuration |
| `4` | Audit execution or dependency failure |

## CI template audit

`.github/workflows/runtime-config-audit.yml` creates an ephemeral placeholder environment from `.env.example`, assigns secure synthetic values to sensitive keys, and validates the template and Docker Compose references. The workflow never reads production secrets.

This catches repository drift such as:

- a new Compose variable that was not added to `.env.example`
- duplicated template keys
- insecure public URL schemes
- unsafe production defaults

## Production operations

Recommended schedule:

```cron
17 * * * * cd /root/Ops-Solutions && bash scripts/audit-runtime-config.sh json >> /var/log/ops-runtime-config-audit.jsonl 2>&1
```

Treat exit code `3` as a deployment blocker. Review warning findings before adding a key to `.env.example`; unknown keys can be intentional, but documenting them keeps the platform reproducible.

## Security boundaries

- The audit is read-only.
- It does not connect to PostgreSQL, Redis, HubSpot, or email providers.
- It does not print values, hashes, connection strings, or file contents.
- It does not modify `.env`.
- Production credentials remain only in `/root/Ops-Solutions/.env`.
