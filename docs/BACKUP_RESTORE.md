# PostgreSQL backup and restore runbook

Ops Solutions stores tenant configuration, encrypted OAuth material, mirrored CRM records, mappings, exports, scheduled reports and audit events in PostgreSQL. A deployable SaaS platform must therefore have backups that are both created and regularly proven restorable.

## Backup

Run from the production project directory:

```bash
bash scripts/backup-postgres.sh
```

Defaults:

- compose file: `docker-compose.prod.yml`
- PostgreSQL service: `postgres`
- backup directory: `/root/Ops-Solutions/backups/postgres`
- retention: 14 days
- archive format: PostgreSQL custom format, compressed, no ownership or ACL statements

The command:

1. acquires a non-blocking host lock to prevent overlapping backups;
2. reads the database name and user inside the PostgreSQL container without printing credentials;
3. writes to a temporary file with mode `0600`;
4. verifies the archive catalog with `pg_restore --list`;
5. publishes a SHA-256 checksum and JSON manifest;
6. removes complete backup-set files older than the configured retention period;
7. deletes partial output automatically on failure.

Override examples:

```bash
bash scripts/backup-postgres.sh --retention-days 30
bash scripts/backup-postgres.sh --backup-root /mnt/private-backups/ops-solutions
```

The host backup directory must remain private and should also be copied to encrypted off-host storage. Repository code intentionally does not choose a cloud storage provider or encryption key.

## Verification

Verification is read-only:

```bash
bash scripts/verify-postgres-backup.sh \
  --file /root/Ops-Solutions/backups/postgres/ops-solutions-host-YYYYMMDDTHHMMSSZ.dump
```

It validates the checksum when the companion `.sha256` file exists and asks the PostgreSQL container to parse the complete archive catalog.

## Restore drill

Restore into a disposable database first:

```bash
bash scripts/restore-postgres-backup.sh \
  --file /root/Ops-Solutions/backups/postgres/ops-solutions-host-YYYYMMDDTHHMMSSZ.dump \
  --target-database ops_restore_drill \
  --confirm RESTORE
```

The restore command:

- validates the archive before touching a database;
- validates the target database identifier;
- blocks the configured production database by default;
- terminates sessions connected only to the explicit target;
- recreates that database;
- restores with `--no-owner`, `--no-acl` and `--exit-on-error`;
- verifies critical `workspaces` and `schema_migrations` tables.

Restoring directly into the configured production database additionally requires:

```bash
--allow-production-target
```

That flag is intentionally explicit and should be used only during a documented incident with application writes stopped and a rollback plan approved.

## Recommended schedule

- create one backup daily;
- verify every backup immediately after creation;
- copy backup sets to encrypted off-host storage;
- perform a disposable restore drill at least monthly;
- record backup timestamp, restore duration and validation result in the operational log;
- alert when the newest successful backup is older than 26 hours.

Example cron entry at 02:15 UTC:

```cron
15 2 * * * cd /root/Ops-Solutions && bash scripts/backup-postgres.sh >> /var/log/ops-solutions-backup.log 2>&1
```

## Disaster recovery sequence

1. Stop API and worker writes while keeping the PostgreSQL container available.
2. Preserve the damaged database before attempting destructive repair.
3. Verify the selected backup and its timestamp.
4. Restore to a disposable database and run validation queries.
5. Confirm tenant counts, HubSpot connection rows, latest sync runs and audit history.
6. Restore to the production database only after approval.
7. Restart services and run `bash scripts/verify-production.sh`.
8. Run an incremental HubSpot sync for connected workspaces to reconcile post-backup CRM changes.

## Deferred external decisions

The repository does not select an off-site storage provider, encryption recipient, regional retention policy or legal retention duration. Those choices require infrastructure and compliance decisions. The local artifacts are permission-restricted but should not be treated as the only backup copy.
