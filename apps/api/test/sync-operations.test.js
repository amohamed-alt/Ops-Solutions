import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { jobNameForMode, normalizeSyncMode } from '../src/sync-operations.js';

test('normalizes supported sync modes', () => {
  assert.equal(normalizeSyncMode(), 'incremental');
  assert.equal(normalizeSyncMode(' INITIAL '), 'initial');
  assert.equal(normalizeSyncMode('full'), 'full');
  assert.equal(normalizeSyncMode('incremental'), 'incremental');
});

test('rejects unsupported sync modes with a client error', () => {
  assert.throws(
    () => normalizeSyncMode('destructive-reset'),
    (error) => error.statusCode === 400 && error.category === 'INVALID_SYNC_MODE'
  );
});

test('maps API modes to worker queue job names', () => {
  assert.equal(jobNameForMode('initial'), 'initial-sync');
  assert.equal(jobNameForMode('incremental'), 'incremental-sync');
  assert.equal(jobNameForMode('full'), 'full-sync');
});

test('creates the readiness snapshot schema before incident foreign keys', async () => {
  const source = await readFile(new URL('../src/sync-operations.js', import.meta.url), 'utf8');
  assert.match(
    source,
    /ensureOnboardingReadinessSchema\(dependencies\.postgres\)\s*\.then\(\(\) => ensureReadinessRegressionSchema\(dependencies\.postgres\)\)/
  );
});
