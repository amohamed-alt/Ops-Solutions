import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyticsIndexDefinitions,
  ensureAnalyticsIndexes,
  runPlannerMaintenance
} from '../src/analytics-maintenance.js';

test('analytics indexes remain workspace scoped and partial where appropriate', () => {
  const definitions = analyticsIndexDefinitions();
  assert.equal(definitions.length, 9);
  assert.equal(new Set(definitions.map((item) => item.name)).size, definitions.length);
  for (const definition of definitions) {
    assert.match(definition.sql, /workspace_id/);
    assert.match(definition.sql, /CREATE INDEX IF NOT EXISTS/);
  }
  assert.ok(definitions.some((item) => item.sql.includes("object_type = 'contacts' AND archived = FALSE")));
  assert.ok(definitions.some((item) => item.sql.includes("object_type = 'deals' AND archived = FALSE")));
  assert.ok(definitions.some((item) => item.sql.includes("object_type IN ('calls', 'meetings', 'tasks')")));
});

test('creates every analytics index and emits timings', async () => {
  const queries = [];
  const events = [];
  const postgres = { query: async (sql) => { queries.push(sql); return { rows: [] }; } };
  const result = await ensureAnalyticsIndexes(postgres, {
    log: (level, event, details) => events.push({ level, event, details })
  });
  assert.equal(result.indexes, analyticsIndexDefinitions().length);
  assert.equal(queries.length, analyticsIndexDefinitions().length);
  assert.equal(events.length, analyticsIndexDefinitions().length);
  assert.ok(events.every((event) => event.event === 'analytics_index_ready'));
});

test('planner maintenance executes once per interval', async () => {
  const queries = [];
  let locked = false;
  const redis = {
    async set() {
      if (locked) return null;
      locked = true;
      return 'OK';
    },
    async del() { locked = false; }
  };
  const postgres = { query: async (sql) => { queries.push(sql); return { rows: [] }; } };
  const first = await runPlannerMaintenance(postgres, redis, { now: 1_000 });
  const second = await runPlannerMaintenance(postgres, redis, { now: 1_000 });
  assert.equal(first.executed, true);
  assert.deepEqual(queries, [
    'ANALYZE crm_records',
    'ANALYZE crm_record_associations',
    'ANALYZE sync_runs'
  ]);
  assert.deepEqual(second, { executed: false, reason: 'already_completed_for_interval' });
});

test('planner maintenance releases the interval lock after failure', async () => {
  let deleted = false;
  const redis = {
    async set() { return 'OK'; },
    async del() { deleted = true; }
  };
  const postgres = { query: async () => { throw new Error('database unavailable'); } };
  await assert.rejects(() => runPlannerMaintenance(postgres, redis), /database unavailable/);
  assert.equal(deleted, true);
});
