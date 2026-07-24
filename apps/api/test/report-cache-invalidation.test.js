import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  parseReportCacheInvalidation,
  REPORT_CACHE_INVALIDATION_CHANNEL
} from '../src/report-cache-invalidation.js';

test('parses only privacy-safe workspace invalidation messages', () => {
  const event = parseReportCacheInvalidation(JSON.stringify({
    workspaceId: '123e4567-e89b-42d3-a456-426614174000',
    reason: 'hubspot_incremental_sync_completed',
    objectTypes: ['contacts', 'deals']
  }));

  assert.equal(REPORT_CACHE_INVALIDATION_CHANNEL, 'ops-solutions:report-cache:invalidate');
  assert.equal(event.workspaceId, '123e4567-e89b-42d3-a456-426614174000');
  assert.deepEqual(event.objectTypes, ['contacts', 'deals']);
  assert.equal(parseReportCacheInvalidation('not-json'), null);
  assert.equal(parseReportCacheInvalidation(JSON.stringify({ workspaceId: '../bad' })), null);
});

test('sync route wrapper starts the subscriber and closes it with the queue', async () => {
  const source = await readFile(new URL('../src/sync-operations.js', import.meta.url), 'utf8');
  assert.match(source, /startReportCacheInvalidationSubscriber/);
  assert.match(source, /clearWorkspace:\s*clearWorkspaceReportCache/);
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /invalidationSubscriber\.close\(\)/);
});
