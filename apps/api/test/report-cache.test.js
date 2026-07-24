import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createReportCache,
  normalizedReportQuery,
  reportCacheKey
} from '../src/report-cache.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('normalizes report queries deterministically without refresh controls', () => {
  assert.deepEqual(normalizedReportQuery({ to: '2026-07-24', refresh: '1', from: '2026-07-01', empty: '' }), [
    ['from', '2026-07-01'],
    ['to', '2026-07-24']
  ]);
  assert.equal(
    reportCacheKey('object', 'workspace-a', { to: '2', from: '1' }, ['contacts']),
    reportCacheKey('object', 'workspace-a', { from: '1', to: '2' }, ['contacts'])
  );
});

test('returns cached values inside the TTL and isolates workspaces', async () => {
  let clock = 1_000;
  let calls = 0;
  const cache = createReportCache({ now: () => clock, maxEntries: 10 });
  const load = async () => ({ sequence: ++calls });

  const first = await cache.execute({ key: 'workspace-a', ttlMs: 1_000, query: {}, loader: load });
  const second = await cache.execute({ key: 'workspace-a', ttlMs: 1_000, query: {}, loader: load });
  const other = await cache.execute({ key: 'workspace-b', ttlMs: 1_000, query: {}, loader: load });

  assert.equal(first.status, 'MISS');
  assert.equal(second.status, 'HIT');
  assert.deepEqual(second.value, first.value);
  assert.equal(other.status, 'MISS');
  assert.equal(calls, 2);

  clock = 2_001;
  const expired = await cache.execute({ key: 'workspace-a', ttlMs: 1_000, query: {}, loader: load });
  assert.equal(expired.status, 'MISS');
  assert.equal(calls, 3);
});

test('coalesces simultaneous report builds and never caches failures', async () => {
  const gate = deferred();
  let calls = 0;
  const cache = createReportCache();
  const loader = async () => {
    calls += 1;
    return gate.promise;
  };

  const firstPromise = cache.execute({ key: 'same-report', ttlMs: 30_000, query: {}, loader });
  const secondPromise = cache.execute({ key: 'same-report', ttlMs: 30_000, query: {}, loader });
  gate.resolve({ ok: true });

  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.equal(calls, 1);
  assert.equal(first.status, 'MISS');
  assert.equal(second.status, 'COALESCED');
  assert.deepEqual(second.value, { ok: true });

  let failureCalls = 0;
  await assert.rejects(() => cache.execute({
    key: 'failing-report',
    ttlMs: 30_000,
    query: {},
    loader: async () => {
      failureCalls += 1;
      throw new Error('database unavailable');
    }
  }), /database unavailable/);
  await assert.rejects(() => cache.execute({
    key: 'failing-report',
    ttlMs: 30_000,
    query: {},
    loader: async () => {
      failureCalls += 1;
      throw new Error('database unavailable');
    }
  }), /database unavailable/);
  assert.equal(failureCalls, 2);
});

test('refresh bypasses cached and inflight values while replacing the snapshot', async () => {
  let calls = 0;
  const cache = createReportCache();
  const loader = async () => ++calls;

  await cache.execute({ key: 'report', ttlMs: 30_000, query: {}, loader });
  const refreshed = await cache.execute({ key: 'report', ttlMs: 30_000, query: { refresh: 'true' }, loader });
  const cached = await cache.execute({ key: 'report', ttlMs: 30_000, query: {}, loader });

  assert.equal(refreshed.status, 'REFRESH');
  assert.equal(refreshed.value, 2);
  assert.equal(cached.status, 'HIT');
  assert.equal(cached.value, 2);
});

test('keeps the resolved cache bounded and supports workspace invalidation', async () => {
  const cache = createReportCache({ maxEntries: 2 });
  await cache.execute({ key: reportCacheKey('report', 'workspace-a', {}, ['one']), ttlMs: 30_000, query: {}, loader: async () => 1 });
  await cache.execute({ key: reportCacheKey('report', 'workspace-a', {}, ['two']), ttlMs: 30_000, query: {}, loader: async () => 2 });
  await cache.execute({ key: reportCacheKey('report', 'workspace-b', {}, ['three']), ttlMs: 30_000, query: {}, loader: async () => 3 });

  assert.equal(cache.stats().resolved, 2);
  cache.clearWorkspace('workspace-a');
  assert.equal(cache.stats().resolved, 1);
});
