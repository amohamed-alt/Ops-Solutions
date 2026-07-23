import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scriptUrl = new URL('../../../scripts/rollback-release.sh', import.meta.url);
const workflowUrl = new URL('../../../.github/workflows/deploy.yml', import.meta.url);
const runbookUrl = new URL('../../../docs/AUTOMATIC_RELEASE_ROLLBACK.md', import.meta.url);

test('release rollback preserves secrets, database backups and release history', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  assert.match(source, /--exclude='\.env'/);
  assert.match(source, /--exclude='\.deploy-backups\/'/);
  assert.match(source, /--exclude='backups\/'/);
  assert.match(source, /Release archive unexpectedly contains \.env/);
  assert.doesNotMatch(source, /pg_restore|dropdb|DROP DATABASE|restore-postgres/i);
});

test('release rollback is bounded, locked and verifies both archive and services', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  assert.match(source, /MAX_ARCHIVE_AGE_MINUTES/);
  assert.match(source, /flock -n/);
  assert.match(source, /gzip -t/);
  assert.match(source, /tar -tzf/);
  assert.match(source, /docker compose -f "\$compose_file" config --quiet/);
  assert.match(source, /VERIFY_MODE=internal/);
  assert.match(source, /last-rollback\.json/);
});

test('deployment workflow attempts rollback before collecting diagnostics', async () => {
  const source = await readFile(workflowUrl, 'utf8');
  const rollback = source.indexOf('Attempt verified automatic release rollback');
  const diagnostics = source.indexOf('Capture deployment diagnostics');
  assert.ok(rollback > 0, 'rollback step must exist');
  assert.ok(diagnostics > rollback, 'rollback must run before diagnostics');
  assert.match(source, /if: failure\(\)/);
  assert.match(source, /MAX_ARCHIVE_AGE_MINUTES=180/);
  assert.match(source, /scripts\/rollback-release\.sh/);
});

test('runbook documents fail-closed scope and manual database recovery', async () => {
  const source = await readFile(runbookUrl, 'utf8');
  assert.match(source, /application files only/i);
  assert.match(source, /database is never restored automatically/i);
  assert.match(source, /three hours/i);
  assert.match(source, /manual database recovery/i);
});
