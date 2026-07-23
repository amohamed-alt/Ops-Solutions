# Verified pre-deployment database backup gate

Every production deployment now creates and verifies a PostgreSQL backup before rebuilding API, worker, web, or database containers.

## Deployment sequence

1. Preserve the current application release archive without copying `.env`.
2. Upload the new repository files while excluding `.env`, database backups, build artifacts, and deployment archives.
3. Detect whether the PostgreSQL Compose service is already running.
4. For an existing installation, run `scripts/backup-postgres.sh` with 14-day local retention.
5. Parse the exact archive path returned by the backup command.
6. Require the archive to exist and pass `scripts/verify-postgres-backup.sh`.
7. Only then rebuild and start Docker services.
8. Run internal and public production smoke checks.

An empty server with no PostgreSQL container is treated as an initial deployment. Existing production installations fail closed if backup creation or verification fails.

## Failure behavior

A failed dump, empty archive, invalid checksum, unreadable PostgreSQL catalog, missing backup path, or concurrent backup lock stops the deployment before containers are rebuilt. Partial backup sets are removed by the backup script.

Deployment diagnostics include only bounded service logs and recent backup manifest filenames. They never include `.env`, database connection strings, HubSpot tokens, encryption keys, backup contents, or raw customer records.

## Storage safety

The rsync deployment excludes:

- `.env` and `.env.*`
- `backups/`
- `.deploy-backups/`
- build and dependency directories

This prevents `rsync --delete` from removing local database backups or production secrets.

## Manual verification

From the deployment directory:

```bash
COMPOSE_FILE=docker-compose.prod.yml scripts/backup-postgres.sh --retention-days 14
scripts/verify-postgres-backup.sh --backup /root/Ops-Solutions/backups/postgres/<archive>.dump
```

The verification command is read-only. It validates SHA-256 when present and asks `pg_restore --list` to parse the archive catalog.

## Recovery

The backup gate does not automatically restore a database or roll back migrations. Automated restore would be unsafe when a release performs non-reversible business changes. Follow `docs/POSTGRES_BACKUP_AND_DISASTER_RECOVERY.md`, restore into an isolated database first, verify the result, then make a deliberate production recovery decision.
