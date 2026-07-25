import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getReadinessDeliveryDeadLetterStatus,
  normalizeDeadLetterOptions,
  requeueReadinessDelivery
} from '../src/readiness-delivery-dead-letter.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const DELIVERY_ID = '22222222-2222-4222-8222-222222222222';

function deadLetterRow(overrides = {}) {
  return {
    id: DELIVERY_ID,
    workspace_id: WORKSPACE_ID,
    incident_id: '33333333-3333-4333-8333-333333333333',
    snapshot_id: '44444444-4444-4444-8444-444444444444',
    kind: 'regression',
    status: 'failed',
    attempts: 5,
    next_attempt_at: new Date('2026-07-25T00:00:00Z'),
    created_at: new Date('2026-07-24T00:00:00Z'),
    updated_at: new Date('2026-07-25T00:00:00Z'),
    error: 'provider unavailable',
    workspace_name: 'Acme',
    ...overrides
  };
}

test('normalizes safe dead-letter operation bounds', () => {
  assert.deepEqual(normalizeDeadLetterOptions({}), {
    action: 'status',
    limit: 100,
    workspaceId: null,
    deliveryId: null,
    apply: false
  });
  assert.throws(() => normalizeDeadLetterOptions({ action: 'delete' }), /status or requeue/);
  assert.throws(() => normalizeDeadLetterOptions({ limit: 0 }), /between 1 and 500/);
  assert.throws(() => normalizeDeadLetterOptions({ workspaceId: 'bad' }), /valid UUID/);
  assert.throws(() => normalizeDeadLetterOptions({ action: 'requeue' }), /workspaceId is required/);
  assert.throws(() => normalizeDeadLetterOptions({ action: 'requeue', workspaceId: WORKSPACE_ID }), /deliveryId is required/);
});

test('returns bounded fleet status without recipient or credential data', async () => {
  const calls = [];
  const db = {
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      if (sql.includes('SELECT count(*)')) {
        return {
          rowCount: 1,
          rows: [{ total: 1, regression: 1, recovery: 0, oldest_updated_at: null, newest_updated_at: null }]
        };
      }
      return { rowCount: 1, rows: [deadLetterRow()] };
    }
  };

  const result = await getReadinessDeliveryDeadLetterStatus(db, { limit: 25 });
  assert.equal(result.scope, 'fleet');
  assert.equal(result.summary.total, 1);
  assert.equal(result.deliveries[0].id, DELIVERY_ID);
  assert.equal(result.deliveries[0].error, 'provider unavailable');
  assert.equal('recipients' in result.deliveries[0], false);
  assert.ok(calls[0].sql.includes("status='failed'"));
  assert.ok(calls[0].sql.includes('attempts >= 5'));
  assert.equal(calls[0].parameters[0], 25);
});

test('scopes dead-letter status to one workspace', async () => {
  const calls = [];
  const db = {
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      return sql.includes('SELECT count(*)')
        ? { rowCount: 1, rows: [{ total: 0, regression: 0, recovery: 0 }] }
        : { rowCount: 0, rows: [] };
    }
  };

  const result = await getReadinessDeliveryDeadLetterStatus(db, { workspaceId: WORKSPACE_ID, limit: 10 });
  assert.equal(result.scope, 'workspace');
  assert.ok(calls.every((call) => call.sql.includes('workspace_id=$1') || call.sql.includes('d.workspace_id=$1')));
  assert.equal(calls[0].parameters[0], WORKSPACE_ID);
});

test('dry-run locks an eligible delivery but does not update it', async () => {
  const calls = [];
  const client = {
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      if (sql.includes('SELECT id,workspace_id')) return { rowCount: 1, rows: [deadLetterRow()] };
      return { rowCount: 0, rows: [] };
    },
    release: () => calls.push({ sql: 'release' })
  };

  const result = await requeueReadinessDelivery({ connect: async () => client }, {
    action: 'requeue',
    workspaceId: WORKSPACE_ID,
    deliveryId: DELIVERY_ID
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.eligible, true);
  assert.equal(result.requeued, false);
  assert.ok(calls.some((call) => call.sql === 'ROLLBACK'));
  assert.equal(calls.some((call) => call.sql.includes("SET status='pending'")), false);
});

test('apply resets only the exact exhausted workspace delivery', async () => {
  const calls = [];
  const client = {
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      if (sql.includes('SELECT id,workspace_id')) return { rowCount: 1, rows: [deadLetterRow()] };
      if (sql.includes("SET status='pending'")) {
        return {
          rowCount: 1,
          rows: [{ id: DELIVERY_ID, workspace_id: WORKSPACE_ID, kind: 'regression', status: 'pending', attempts: 0 }]
        };
      }
      return { rowCount: 0, rows: [] };
    },
    release: () => calls.push({ sql: 'release' })
  };

  const result = await requeueReadinessDelivery({ connect: async () => client }, {
    action: 'requeue',
    workspaceId: WORKSPACE_ID,
    deliveryId: DELIVERY_ID,
    apply: true
  });

  assert.equal(result.requeued, true);
  const update = calls.find((call) => call.sql.includes("SET status='pending'"));
  assert.deepEqual(update.parameters, [DELIVERY_ID, WORKSPACE_ID]);
  assert.ok(update.sql.includes("status='failed'"));
  assert.ok(update.sql.includes('attempts >= 5'));
  assert.ok(update.sql.includes('attempts=0'));
  assert.ok(update.sql.includes('claimed_at=NULL'));
  assert.ok(calls.some((call) => call.sql === 'COMMIT'));
});
