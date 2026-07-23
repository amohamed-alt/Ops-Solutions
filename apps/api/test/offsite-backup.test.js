import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const stagePath = new URL('../../../scripts/stage-encrypted-offsite-backup.sh', import.meta.url);
const verifyPath = new URL('../../../scripts/verify-encrypted-offsite-backup.sh', import.meta.url);
const docsPath = new URL('../../../docs/ENCRYPTED_OFFSITE_BACKUPS.md', import.meta.url);

test('offsite staging verifies source backups and encrypts without plaintext tar artifacts', async () => {
  const source = await readFile(stagePath, 'utf8');
  assert.match(source, /age --encrypt --recipient/);
  assert.match(source, /tar --create/);
  assert.match(source, /\.partial/);
  assert.match(source, /sha256sum/);
  assert.match(source, /flock -n/);
  assert.match(source, /--dry-run/);
  assert.match(source, /RETENTION_DAYS/);
  assert.match(source, /sourceSha256/);
  assert.doesNotMatch(source, /age --decrypt|AGE_IDENTITY|POSTGRES_PASSWORD|access_token|refresh_token/);
  assert.doesNotMatch(source, /\.tar([^.]|$)/);
});

test('offsite verification is read-only and can stream decrypt directly into tar listing', async () => {
  const source = await readFile(verifyPath, 'utf8');
  assert.match(source, /encryptedSha256/);
  assert.match(source, /sha256sum/);
  assert.match(source, /age --decrypt --identity/);
  assert.match(source, /tar --list --file -/);
  assert.doesNotMatch(source, /rm -rf|dropdb|createdb|pg_restore[^\n]*--dbname/);
  assert.doesNotMatch(source, /POSTGRES_PASSWORD|access_token|refresh_token/);
});

test('offsite backup runbook documents provider-neutral encrypted replication and recovery', async () => {
  const source = await readFile(docsPath, 'utf8');
  assert.match(source, /age recipient/i);
  assert.match(source, /mounted/i);
  assert.match(source, /dry-run/i);
  assert.match(source, /restore drill/i);
  assert.match(source, /private key/i);
  assert.match(source, /stage-encrypted-offsite-backup\.sh/);
  assert.match(source, /verify-encrypted-offsite-backup\.sh/);
});
