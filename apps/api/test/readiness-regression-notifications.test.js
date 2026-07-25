import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReadinessIncidentMessage,
  claimReadinessDelivery,
  normalizeNotificationOptions
} from '../src/readiness-regression-notifications.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const DELIVERY_ID = '22222222-2222-4222-8222-222222222222';

function deliveryRow(overrides = {}) {
  return {
    id: DELIVERY_ID,
    incident_id: '33333333-3333-4333-8333-333333333333',
    workspace_id: WORKSPACE_ID,
    snapshot_id: '44444444-4444-4444-8444-444444444444',
    kind: 'regression',
    attempts: 0,
    workspace_name: 'Acme <script>',
    score: 62,
    blockers: 2,
    warnings: 1,
    ...overrides
  };
}

test('normalizes bounded delivery limits', () => {
  assert.deepEqual(normalizeNotificationOptions({}), { limit: 50 });
  assert.deepEqual(normalizeNotificationOptions({ limit: 200 }), { limit: 200 });
  assert.throws(() => normalizeNotificationOptions({ limit: 0 }), /between 1 and 200/);
  assert.throws(() => normalizeNotificationOptions({ limit: 201 }), /between 1 and 200/);
});

test('builds escaped tenant-safe regression and recovery messages', () => {
  const regression = buildReadinessIncidentMessage(deliveryRow(), 'https://ops.example.com/');
  assert.match(regression.subject, /Action required/);
  assert.match(regression.text, /2 blocker/);
  assert.doesNotMatch(regression.html, /<script>/);
  assert.match(regression.html, /Acme &lt;script&gt;/i);
  assert.match(regression.html, /workspaceId=11111111-1111-4111-8111-111111111111/);

  const recovery = buildReadinessIncidentMessage(deliveryRow({ kind: 'recovery', score: 100, blockers: 0 }), 'https://ops.example.com');
  assert.match(recovery.subject, /Recovered/);
  assert.match(recovery.text, /production-ready/);
});

test('claims one delivery with row locking and owner/admin recipients', async () => {
  const calls = [];
  const client = {
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      if (sql.includes('FOR UPDATE OF d SKIP LOCKED')) return { rowCount: 1, rows: [deliveryRow()] };
      if (sql.includes('FROM workspace_memberships')) {
        return { rowCount: 2, rows: [{ email: 'admin@example.com' }, { email: 'owner@example.com' }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release: () => calls.push({ sql: 'release' })
  };

  const result = await claimReadinessDelivery({ connect: async () => client });
  assert.deepEqual(result.recipients, ['admin@example.com', 'owner@example.com']);
  assert.ok(calls.some((call) => call.sql.includes("m.role IN ('owner','admin')")));
  assert.ok(calls.some((call) => call.sql.includes("status='sending'")));
  assert.ok(calls.some((call) => call.sql.includes('recipients=$2::jsonb')));
  assert.equal(calls[0].sql, 'BEGIN');
  assert.equal(calls.at(-2).sql, 'COMMIT');
  assert.equal(calls.at(-1).sql, 'release');
});

test('does not send when a workspace has no active owner or admin', async () => {
  const calls = [];
  const client = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes('FOR UPDATE OF d SKIP LOCKED')) return { rowCount: 1, rows: [deliveryRow()] };
      if (sql.includes('FROM workspace_memberships')) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    },
    release: () => undefined
  };

  const result = await claimReadinessDelivery({ connect: async () => client });
  assert.equal(result.skipped, true);
  assert.deepEqual(result.recipients, []);
  assert.ok(calls.some((sql) => sql.includes("error='no_active_owner_or_admin_recipient'")));
  assert.ok(calls.some((sql) => sql.includes("INTERVAL '24 hours'")));
});
