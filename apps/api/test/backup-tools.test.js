import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const backupPath = new URL('../../../scripts/backup-postgres.sh', import.meta.url);
const verifyPath = new URL('../../../scripts/verify-postgres-backup.sh', import.meta.url);
const restorePath = new URL('../../../scripts/restore-postgres-backup.sh', import.meta.url);
const docsPath = new URL('../../../docs/BACKUP_RESTORE.md', import.meta.url);

test('backup tooling creates private verified archives without exposing database secrets', async () => {
  const source = await readFile(backupPath, 'utf8');
  assert.match(source, /set -Eeuo pipefail/);
  assert.match(source, /flock -n/);
  assert.match(source, /umask 077/);
  assert.match(source, /pg_dump[^\n]*--format=custom/);
  assert.match(source, /pg_restore --list/);
  assert.match(source, /sha256sum/);
  assert.match(source, /manifest\.json/);
  assert.match(source, /cleanup_partial/);
  assert.match(source, /RETENTION_DAYS/);
  assert.doesNotMatch(source, /echo .*POSTGRES_PASSWORD/);
});

test('verification is read-only and validates both checksum and archive catalog', async () => {
  const source = await readFile(verifyPath, 'utf8');
  assert.match(source, /sha256sum/);
  assert.match(source, /pg_restore --list/);
  assert.doesNotMatch(source, /dropdb|createdb|pg_restore[^\n]*--dbname/);
});

test('restore requires explicit confirmation and blocks production by default', async () => {
  const source = await readFile(restorePath, 'utf8');
  assert.match(source, /--confirm/);
  assert.match(source, /CONFIRMATION.*RESTORE/);
  assert.match(source, /--allow-production-target/);
  assert.match(source, /Refusing to restore into the configured production database/);
  assert.match(source, /pg_terminate_backend/);
  assert.match(source, /dropdb[^\n]*--if-exists/);
  assert.match(source, /pg_restore[^\n]*--exit-on-error/);
  assert.match(source, /SELECT 1 FROM workspaces/);
  assert.match(source, /SELECT 1 FROM schema_migrations/);
});

test('runbook documents off-host copies, restore drills and recovery sequencing', async () => {
  const source = await readFile(docsPath, 'utf8');
  assert.match(source, /encrypted off-host storage/i);
  assert.match(source, /restore drill/i);
  assert.match(source, /Disaster recovery sequence/);
  assert.match(source, /incremental HubSpot sync/);
  assert.match(source, /older than 26 hours/);
});
