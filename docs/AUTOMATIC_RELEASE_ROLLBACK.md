# Automatic production release rollback

The production deployment keeps a compressed copy of the currently running application before uploading a new release. If the new containers fail to start, fail the internal smoke checks, or fail the public HTTPS checks, GitHub Actions now attempts one bounded rollback to that previous application release.

## Scope

The rollback restores application files only. It rebuilds the previous Docker Compose release and runs the internal production verifier before declaring the rollback successful.

The database is never restored automatically. PostgreSQL backups remain available for deliberate manual database recovery because restoring database contents can discard newer customer data and requires an explicit incident decision.

The following paths are always preserved:

- `.env`
- `backups/`
- `.deploy-backups/`
- runtime logs and build caches

## Safety controls

- Only `release-*.tar.gz` archives inside the deployment `.deploy-backups` directory are accepted.
- Automatic rollback accepts an archive no older than three hours by default.
- `gzip` and `tar` integrity checks run before any application file is changed.
- The archive must contain a Docker Compose definition and `scripts/verify-production.sh`.
- A non-blocking `flock` prevents concurrent rollbacks.
- Restoration uses `rsync --delete` with explicit exclusions for secrets and persistent data.
- Docker Compose configuration is validated before rebuilding.
- The restored release must pass the internal production verifier.
- Rollback state is written atomically to `.deploy-backups/last-rollback.json` without secrets or customer data.

## Deployment behavior

1. Archive the currently deployed application.
2. Upload the candidate release.
3. Create and verify a PostgreSQL backup.
4. Build and start the candidate containers.
5. Run internal and public smoke checks.
6. On failure, restore the latest eligible application archive and verify it internally.
7. Collect diagnostics regardless of rollback outcome.

The GitHub Actions run remains failed even when rollback succeeds. This is intentional: the candidate release did not deploy successfully and requires investigation, while production should have returned to the previous verified application version.

## Manual execution

From the production deployment directory:

```bash
chmod +x scripts/rollback-release.sh
DEPLOY_PATH=/root/Ops-Solutions \
MAX_ARCHIVE_AGE_MINUTES=180 \
scripts/rollback-release.sh
```

To select a specific eligible archive:

```bash
DEPLOY_PATH=/root/Ops-Solutions \
RELEASE_ARCHIVE=/root/Ops-Solutions/.deploy-backups/release-YYYYMMDD-HHMMSS.tar.gz \
scripts/rollback-release.sh
```

## Incident response

After an automatic rollback:

1. Inspect the GitHub deployment diagnostics artifact.
2. Inspect `.deploy-backups/last-rollback.json` on the VPS.
3. Confirm the public onboarding and health routes.
4. Identify whether the failure came from build, migration, container health, reverse proxy, or public routing.
5. Fix the candidate on a new branch and require successful CI before another deployment.

If the previous application release is also unhealthy, stop automated retries and follow the manual database recovery and disaster-recovery runbooks. Database restoration must remain a separately approved action.
