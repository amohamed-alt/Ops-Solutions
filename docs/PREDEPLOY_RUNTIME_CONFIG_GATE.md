# Pre-deployment runtime configuration gate

Production-changing PostgreSQL backup operations now run a fail-closed audit of the VPS runtime configuration before touching the database. The deployment workflow already requires a verified PostgreSQL backup before rebuilding services, so an unsafe configuration blocks the release before `docker compose up --build`.

## Policy

The gate runs `scripts/audit-runtime-config.sh json` against `/root/Ops-Solutions/.env` by default.

- Healthy configuration: continue.
- Warning findings: warnings do not block deployment, but the sanitized report is retained for follow-up.
- Critical findings: critical findings block deployment before PostgreSQL access or service rebuild.
- Audit execution failure: block deployment because configuration safety could not be established.

The audit never persists or prints configuration values. Its output contains finding codes, affected key names, severity and safe remediation text only.

## Stored result

The latest successful or warning-only audit is atomically written to:

```text
/root/Ops-Solutions/.deploy-backups/last-runtime-config-audit.json
```

The file is written with mode `0600`. Critical or incomplete audit output is deleted rather than published.

## Manual verification

From the deployment directory:

```bash
OPS_DEPLOY_PATH=/root/Ops-Solutions \
  bash scripts/predeploy-runtime-gate.sh
```

Exit codes:

- `0`: healthy, or warning-only audit recorded successfully.
- `3`: critical production configuration issue.
- `4`: the audit could not run safely.

## Deployment sequence

For an established installation with a running PostgreSQL service:

1. Upload application files while preserving `.env`, backups and release archives.
2. Run the runtime configuration gate.
3. Create and verify the PostgreSQL backup.
4. Build and start Docker services.
5. Run internal and public smoke verification.
6. Attempt application-only rollback if verification fails.

The current workflow treats a host without a running PostgreSQL container as an initial deployment and skips the database backup step. On an initial deployment, Docker Compose still validates required environment expansion before services start. After PostgreSQL is established, every subsequent production release is protected by this runtime gate.

## Recovery

When the gate blocks a release:

1. Read only the sanitized finding metadata from `scripts/audit-runtime-config.sh json`.
2. Correct `/root/Ops-Solutions/.env` directly on the VPS without copying values into GitHub, logs or chat.
3. Restrict the file to mode `0600`.
4. Run the gate manually.
5. Re-run the failed deployment after the audit passes.

Do not bypass the gate by disabling the audit or weakening production flags. A missing, malformed or unsafe runtime configuration is safer to stop than to deploy.
