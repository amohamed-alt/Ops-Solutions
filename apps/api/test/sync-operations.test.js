import assert from 'node:assert/strict';
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
