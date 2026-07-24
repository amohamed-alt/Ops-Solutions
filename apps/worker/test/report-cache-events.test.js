import assert from 'node:assert/strict';
import test from 'node:test';

import {
  publishReportCacheInvalidation,
  REPORT_CACHE_INVALIDATION_CHANNEL,
  runWithReportInvalidation
} from '../src/report-cache-events.js';

function fakeRedis() {
  const published = [];
  return {
    published,
    async publish(channel, message) {
      published.push({ channel, payload: JSON.parse(message) });
      return 1;
    }
  };
}

test('publishes bounded workspace-scoped invalidation events', async () => {
  const redis = fakeRedis();
  await publishReportCacheInvalidation(redis, {
    workspaceId: '123e4567-e89b-42d3-a456-426614174000',
    reason: 'sync_completed',
    objectTypes: ['contacts', 'deals']
  });

  assert.equal(redis.published[0].channel, REPORT_CACHE_INVALIDATION_CHANNEL);
  assert.equal(redis.published[0].payload.workspaceId, '123e4567-e89b-42d3-a456-426614174000');
  assert.deepEqual(redis.published[0].payload.objectTypes, ['contacts', 'deals']);
  await assert.rejects(
    publishReportCacheInvalidation(redis, { workspaceId: 'bad' }),
    /valid workspaceId/
  );
});

test('invalidates after successful and partially failed synchronization', async () => {
  const redis = fakeRedis();
  const event = {
    workspaceId: '123e4567-e89b-42d3-a456-426614174000',
    reason: 'hubspot_sync_completed'
  };

  const result = await runWithReportInvalidation(redis, event, async () => ({
    summary: { completed: [{ objectType: 'contacts' }] }
  }));
  assert.equal(result.summary.completed[0].objectType, 'contacts');
  assert.equal(redis.published[0].payload.reason, 'hubspot_sync_completed');

  const partial = new Error('partial');
  partial.summary = { completed: [{ objectType: 'deals' }] };
  await assert.rejects(
    runWithReportInvalidation(redis, event, async () => { throw partial; }),
    /partial/
  );
  assert.equal(redis.published[1].payload.reason, 'hubspot_sync_completed_with_error');
  assert.deepEqual(redis.published[1].payload.objectTypes, ['deals']);
});
