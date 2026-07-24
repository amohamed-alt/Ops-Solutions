import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateReadinessFleet,
  pruneReadinessSnapshots,
  summarizeFleetResults,
  withDatabaseTransaction
} from '../src/onboarding-readiness-operations.js';

test('summarizeFleetResults separates readiness transitions and failures', () => {
  assert.deepEqual(summarizeFleetResults([
    { ok: true, ready: true, transitioned: true },
    { ok: true, ready: false, transitioned: false },
    { ok: false }
  ]), {
    evaluated: 3,
    ready: 1,
    blocked: 1,
    transitioned: 1,
    failed: 1
  });
});

test('withDatabaseTransaction commits successful work and always releases', async () => {
  const calls = [];
  const client = {
    query: async (sql) => calls.push(sql),
    release: () => calls.push('release')
  };
  const result = await withDatabaseTransaction({ connect: async () => client }, async () => 'done');
  assert.equal(result, 'done');
  assert.deepEqual(calls, ['BEGIN', 'COMMIT', 'release']);
});

test('withDatabaseTransaction rolls back failed work', async () => {
  const calls = [];
  const client = {
    query: async (sql) => calls.push(sql),
    release: () => calls.push('release')
  };
  await assert.rejects(
    withDatabaseTransaction({ connect: async () => client }, async () => { throw new Error('boom'); }),
    /boom/
  );
  assert.deepEqual(calls, ['BEGIN', 'ROLLBACK', 'release']);
});

test('fleet evaluation is skipped when the advisory lock is held', async () => {
  const calls = [];
  const lockClient = {
    query: async (sql) => {
      calls.push(sql);
      return { rows: [{ locked: false }] };
    },
    release: () => calls.push('release')
  };
  const postgres = {
    connect: async () => lockClient,
    query: async () => { throw new Error('workspace query must not run'); }
  };
  const result = await evaluateReadinessFleet({
    postgres,
    ensureSchema: async () => undefined,
    now: new Date('2026-07-24T12:00:00.000Z')
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'another_fleet_evaluation_is_running');
  assert.deepEqual(calls, ['SELECT pg_try_advisory_lock($1) AS locked', 'release']);
});

test('fleet evaluation persists each active workspace and isolates failures', async () => {
  const lockCalls = [];
  const lockClient = {
    query: async (sql) => {
      lockCalls.push(sql);
      if (sql.includes('pg_try')) return { rows: [{ locked: true }] };
      return { rows: [] };
    },
    release: () => lockCalls.push('release')
  };
  const postgres = {
    connect: async () => lockClient,
    query: async (sql, parameters) => {
      assert.match(sql, /WHERE status='active'/);
      assert.deepEqual(parameters, [10000]);
      return { rows: [
        { id: '11111111-1111-4111-8111-111111111111', name: 'Alpha' },
        { id: '22222222-2222-4222-8222-222222222222', name: 'Beta' }
      ] };
    }
  };
  const calls = [];
  const evaluator = async (input) => {
    calls.push(input);
    if (input.workspaceId.startsWith('2222')) {
      const error = new Error('temporary failure');
      error.category = 'SYNC_UNAVAILABLE';
      throw error;
    }
    return {
      summary: { ready: true, score: 100, blockers: 0, warnings: 0 },
      snapshot: { id: 'snapshot-1', transitioned: true }
    };
  };
  const result = await evaluateReadinessFleet({
    postgres,
    evaluator,
    ensureSchema: async () => undefined,
    concurrency: 2,
    now: new Date('2026-07-24T12:00:00.000Z')
  });
  assert.equal(result.skipped, false);
  assert.deepEqual(result.summary, { evaluated: 2, ready: 1, blocked: 0, transitioned: 1, failed: 1 });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.triggerSource === 'system'));
  assert.deepEqual(lockCalls, [
    'SELECT pg_try_advisory_lock($1) AS locked',
    'SELECT pg_advisory_unlock($1)',
    'release'
  ]);
});

test('prune preview preserves transitions and minimum recent snapshots', async () => {
  let captured;
  const postgres = {
    query: async (sql, parameters) => {
      captured = { sql, parameters };
      return { rows: [{ candidate_count: 14, workspace_count: 3 }] };
    }
  };
  const result = await pruneReadinessSnapshots({ postgres, retentionDays: 365, minimumSnapshots: 50 });
  assert.equal(result.dryRun, true);
  assert.equal(result.candidates, 14);
  assert.equal(result.workspaces, 3);
  assert.match(captured.sql, /ROW_NUMBER\(\) OVER \(PARTITION BY workspace_id/);
  assert.match(captured.sql, /transitioned = FALSE/);
  assert.deepEqual(captured.parameters, [50, 365]);
});

test('prune apply remains tenant scoped when workspace is supplied', async () => {
  let captured;
  const postgres = {
    query: async (sql, parameters) => {
      captured = { sql, parameters };
      return {
        rowCount: 2,
        rows: [
          { workspace_id: '11111111-1111-4111-8111-111111111111' },
          { workspace_id: '11111111-1111-4111-8111-111111111111' }
        ]
      };
    }
  };
  const result = await pruneReadinessSnapshots({
    postgres,
    workspaceId: '11111111-1111-4111-8111-111111111111',
    dryRun: false
  });
  assert.equal(result.deleted, 2);
  assert.equal(result.workspaces, 1);
  assert.match(captured.sql, /DELETE FROM onboarding_readiness_snapshots/);
  assert.match(captured.sql, /AND workspace_id=\$3/);
  assert.deepEqual(captured.parameters, [30, 180, '11111111-1111-4111-8111-111111111111']);
});

test('prune rejects malformed workspace identifiers before querying', async () => {
  await assert.rejects(
    pruneReadinessSnapshots({ postgres: { query: async () => undefined }, workspaceId: 'not-a-uuid' }),
    /valid workspace UUID/
  );
});
