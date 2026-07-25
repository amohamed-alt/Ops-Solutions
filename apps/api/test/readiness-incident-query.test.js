import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listReadinessRegressionIncidentPage,
  normalizeReadinessIncidentQuery
} from '../src/readiness-incident-query.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

function database({ total = 3, rows = [] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('COUNT(*)')) return { rows: [{ total }] };
      return { rows };
    }
  };
}

test('normalizes bounded tenant-scoped filters', () => {
  assert.deepEqual(normalizeReadinessIncidentQuery({
    workspaceId: WORKSPACE_ID,
    status: 'active',
    severity: 'critical',
    minimumBlockers: '2',
    sort: 'blockers_desc',
    limit: '30'
  }), {
    workspaceId: WORKSPACE_ID,
    status: 'active',
    severity: 'critical',
    minimumBlockers: 2,
    sort: 'blockers_desc',
    limit: 30,
    offset: 0
  });
});

test('rejects invalid UUIDs, enum values, and oversized limits', () => {
  assert.throws(() => normalizeReadinessIncidentQuery({ workspaceId: 'other' }), /valid UUID/);
  assert.throws(() => normalizeReadinessIncidentQuery({ workspaceId: WORKSPACE_ID, status: 'deleted' }), /status is invalid/);
  assert.throws(() => normalizeReadinessIncidentQuery({ workspaceId: WORKSPACE_ID, limit: 51 }), /between 1 and 50/);
});

test('applies filters and returns an opaque next cursor', async () => {
  const rows = Array.from({ length: 3 }, (_, index) => ({ id: `incident-${index}` }));
  const db = database({ total: 7, rows });
  const page = await listReadinessRegressionIncidentPage(db, {
    workspaceId: WORKSPACE_ID,
    status: 'active',
    severity: 'warning',
    minimumBlockers: 1,
    sort: 'activity_desc',
    limit: 2
  });

  assert.equal(page.rows.length, 2);
  assert.equal(page.total, 7);
  assert.equal(page.pageInfo.hasNextPage, true);
  assert.ok(page.pageInfo.nextCursor);
  assert.match(db.calls[0].sql, /i\.workspace_id = \$1/);
  assert.match(db.calls[0].sql, /i\.status <> 'resolved'/);
  assert.match(db.calls[0].sql, /i\.severity = \$2/);
  assert.match(db.calls[0].sql, /s\.blockers >= \$3/);
  assert.match(db.calls[1].sql, /ORDER BY i\.updated_at DESC, i\.id DESC/);
});

test('binds a cursor to its original filter set', async () => {
  const db = database({ rows: [{ id: 'a' }, { id: 'b' }] });
  const first = await listReadinessRegressionIncidentPage(db, {
    workspaceId: WORKSPACE_ID,
    status: 'all',
    limit: 1
  });

  const secondDb = database({ rows: [] });
  await listReadinessRegressionIncidentPage(secondDb, {
    workspaceId: WORKSPACE_ID,
    status: 'all',
    limit: 1,
    cursor: first.pageInfo.nextCursor
  });
  assert.equal(secondDb.calls[1].values.at(-1), 1);

  assert.throws(() => normalizeReadinessIncidentQuery({
    workspaceId: WORKSPACE_ID,
    status: 'resolved',
    limit: 1,
    cursor: first.pageInfo.nextCursor
  }), /does not match/);
});

test('never interpolates user-provided filter values into SQL', async () => {
  const db = database({ rows: [] });
  await listReadinessRegressionIncidentPage(db, {
    workspaceId: WORKSPACE_ID,
    status: 'open',
    severity: 'critical',
    minimumBlockers: 4,
    sort: 'score_asc'
  });
  const sql = db.calls.map((call) => call.sql).join('\n');
  assert.doesNotMatch(sql, new RegExp(WORKSPACE_ID));
  assert.deepEqual(db.calls[0].values, [WORKSPACE_ID, 'open', 'critical', 4]);
  assert.match(db.calls[1].sql, /ORDER BY s\.score ASC, i\.updated_at DESC, i\.id DESC/);
});
