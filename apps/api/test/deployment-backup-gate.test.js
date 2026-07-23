import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowPath = new URL('../../../.github/workflows/deploy.yml', import.meta.url);
const verifierPath = new URL('../../../scripts/verify-postgres-backup.sh', import.meta.url);

test('production deployment creates and verifies a database backup before Docker rebuild', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  const backupStep = workflow.indexOf('Create verified pre-deployment database backup');
  const buildStep = workflow.indexOf('Build and start Docker services');
  assert.ok(backupStep > 0, 'backup gate is missing');
  assert.ok(buildStep > backupStep, 'database backup must run before service rebuild');
  assert.match(workflow, /scripts\/backup-postgres\.sh --retention-days 14/);
  assert.match(workflow, /scripts\/verify-postgres-backup\.sh --backup/);
  assert.match(workflow, /test -n .*backup_file.*test -f/);
});

test('deployment upload preserves database backups and production environment', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  assert.match(workflow, /--exclude='\.env'/);
  assert.match(workflow, /--exclude='backups\/'/);
  assert.match(workflow, /--exclude='\.deploy-backups\/'/);
  assert.doesNotMatch(workflow, /cat .*\.env/);
});

test('backup verifier accepts the deployment alias without weakening read-only verification', async () => {
  const source = await readFile(verifierPath, 'utf8');
  assert.match(source, /--file\|--backup/);
  assert.match(source, /pg_restore --list/);
  assert.match(source, /Checksum verification failed/);
  assert.doesNotMatch(source, /pg_restore.*--clean|dropdb|createdb|psql .*DROP/i);
});
