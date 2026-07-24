import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateWorkspaceOnboardingReadiness,
  persistReadinessSnapshot,
  summarizeReadiness
} from '../src/onboarding-readiness.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-07-24T12:00:00.000Z');

function fakePostgres(overrides = {}) {
  const queries = [];
  const responses = {
    workspaces: {
      rowCount: 1,
      rows: [{
        id: WORKSPACE_ID,
        name: 'Acme Arabia',
        status: 'active',
        portal_id: 123456,
        connection_status: 'connected',
        last_discovered_at: '2026-07-24T10:00:00.000Z',
        scope_count: 8
      }]
    },
    crm_properties: {
      rowCount: 3,
      rows: [
        { object_type: 'contacts', property_count: 50 },
        { object_type: 'companies', property_count: 40 },
        { object_type: 'deals', property_count: 60 }
      ]
    },
    property_mappings: {
      rowCount: 1,
      rows: [{ approved_count: 6, user_approved_count: 4, latest_mapping_at: '2026-07-24T10:30:00.000Z' }]
    },
    sync_runs: {
      rowCount: 1,
      rows: [{ status: 'completed', mode: 'initial', summary: { processed: 300 }, completed_at: '2026-07-24T11:00:00.000Z' }]
    },
    crm_records: {
      rowCount: 1,
      rows: [{ record_count: 300, newest_sync: '2026-07-24T11:00:00.000Z', object_count: 3 }]
    },
    workspace_memberships: {
      rowCount: 1,
      rows: [{ member_count: 3, owner_count: 1, admin_count: 2 }]
    },
    audit_events: {
      rowCount: 1,
      rows: [{ audit_count: 12, latest_audit_at: '2026-07-24T11:30:00.000Z' }]
    },
    ...overrides
  };

  return {
    queries,
    async query(sql, values) {
      const text = String(sql);
      queries.push({ sql: text, values });
      const key = Object.keys(responses).find((name) => text.includes(`FROM ${name}`));
      if (!key) throw new Error(`Unexpected query: ${text}`);
      return responses[key];
    }
  };
}

function readyReport(ready = true) {
  return {
    workspace: { id: WORKSPACE_ID, name: 'Acme Arabia', status: 'active' },
    generatedAt: NOW.toISOString(),
    policy: { freshnessHours: 24, requiredCoreObjects: ['contacts', 'companies', 'deals'] },
    summary: { ready, score: ready ? 100 : 75, blockers: ready ? 0 : 2, warnings: 0 },
    checks: [{ key: 'hubspot_connected', state: ready ? 'pass' : 'blocked' }],
    nextActions: ready ? [] : [{ key: 'hubspot_connected', state: 'blocked', action: 'Connect HubSpot.' }]
  };
}

test('marks a fully configured tenant ready using workspace-scoped evidence only', async () => {
  const postgres = fakePostgres();
  const report = await evaluateWorkspaceOnboardingReadiness(postgres, WORKSPACE_ID, { now: NOW });
  assert.equal(report.summary.ready, true);
  assert.equal(report.summary.blockers, 0);
  assert.equal(report.summary.score, 100);
  assert.equal(report.checks.length, 8);
  assert.equal(report.nextActions.length, 0);
  assert.ok(postgres.queries.every((query) => query.values?.[0] === WORKSPACE_ID));
  assert.ok(postgres.queries.every((query) => /workspace_id\s*=\s*\$1|w\.id\s*=\s*\$1/.test(query.sql)));
});

test('blocks production readiness when OAuth, discovery, mappings, sync and ownership are incomplete', async () => {
  const postgres = fakePostgres({
    workspaces: {
      rowCount: 1,
      rows: [{ id: WORKSPACE_ID, name: 'Incomplete', status: 'active', portal_id: null, connection_status: null, last_discovered_at: null, scope_count: 0 }]
    },
    crm_properties: { rowCount: 0, rows: [] },
    property_mappings: { rowCount: 1, rows: [{ approved_count: 0, user_approved_count: 0, latest_mapping_at: null }] },
    sync_runs: { rowCount: 0, rows: [] },
    crm_records: { rowCount: 1, rows: [{ record_count: 0, newest_sync: null, object_count: 0 }] },
    workspace_memberships: { rowCount: 1, rows: [{ member_count: 1, owner_count: 0, admin_count: 0 }] },
    audit_events: { rowCount: 1, rows: [{ audit_count: 0, latest_audit_at: null }] }
  });
  const report = await evaluateWorkspaceOnboardingReadiness(postgres, WORKSPACE_ID, { now: NOW });
  assert.equal(report.summary.ready, false);
  assert.ok(report.summary.blockers >= 5);
  assert.ok(report.nextActions.some((item) => item.key === 'hubspot_connected'));
  assert.ok(report.nextActions.some((item) => item.key === 'workspace_ownership'));
});

test('treats stale synchronized data as a warning instead of hiding completed onboarding', async () => {
  const postgres = fakePostgres({
    crm_records: {
      rowCount: 1,
      rows: [{ record_count: 300, newest_sync: '2026-07-22T00:00:00.000Z', object_count: 3 }]
    }
  });
  const report = await evaluateWorkspaceOnboardingReadiness(postgres, WORKSPACE_ID, { now: NOW, freshnessHours: 24 });
  const freshness = report.checks.find((item) => item.key === 'data_freshness');
  assert.equal(freshness.state, 'warning');
  assert.equal(report.summary.ready, true);
  assert.equal(report.summary.warnings, 1);
});

test('rejects invalid tenant identifiers before issuing SQL', async () => {
  const postgres = fakePostgres();
  await assert.rejects(
    evaluateWorkspaceOnboardingReadiness(postgres, 'not-a-workspace'),
    (error) => error.category === 'ONBOARDING_READINESS_INVALID' && error.statusCode === 400
  );
  assert.equal(postgres.queries.length, 0);
});

test('readiness scoring never lets warnings masquerade as full completion', () => {
  const summary = summarizeReadiness([
    { state: 'pass' },
    { state: 'warning' },
    { state: 'blocked' }
  ]);
  assert.deepEqual(summary, {
    ready: false,
    score: 50,
    total: 3,
    passed: 1,
    warnings: 1,
    blockers: 1
  });
});

test('persists a tenant-scoped snapshot and records blocked-to-ready transitions', async () => {
  const queries = [];
  const client = {
    async query(sql, values) {
      const text = String(sql);
      queries.push({ sql: text, values });
      if (text.includes('pg_advisory_xact_lock')) return { rowCount: 1, rows: [] };
      if (text.includes('SELECT ready FROM onboarding_readiness_snapshots')) {
        return { rowCount: 1, rows: [{ ready: false }] };
      }
      if (text.includes('INSERT INTO onboarding_readiness_snapshots')) {
        return {
          rowCount: 1,
          rows: [{
            id: '33333333-3333-4333-8333-333333333333',
            workspace_id: WORKSPACE_ID,
            ready: true,
            score: 100,
            blockers: 0,
            warnings: 0,
            previous_ready: false,
            transitioned: true,
            trigger_source: 'customer_api',
            generated_at: NOW.toISOString(),
            created_at: NOW.toISOString()
          }]
        };
      }
      throw new Error(`Unexpected query: ${text}`);
    }
  };

  const snapshot = await persistReadinessSnapshot(client, readyReport(true), {
    userId: USER_ID,
    triggerSource: 'customer_api'
  });
  assert.equal(snapshot.transitioned, true);
  assert.equal(snapshot.previous_ready, false);
  const insert = queries.find((query) => query.sql.includes('INSERT INTO onboarding_readiness_snapshots'));
  assert.equal(insert.values[0], WORKSPACE_ID);
  assert.equal(insert.values[1], USER_ID);
  assert.equal(insert.values[7], false);
  assert.equal(insert.values[8], true);
});

test('first readiness snapshot does not create a false transition', async () => {
  const client = {
    async query(sql) {
      const text = String(sql);
      if (text.includes('pg_advisory_xact_lock')) return { rowCount: 1, rows: [] };
      if (text.includes('SELECT ready FROM onboarding_readiness_snapshots')) return { rowCount: 0, rows: [] };
      if (text.includes('INSERT INTO onboarding_readiness_snapshots')) {
        return { rowCount: 1, rows: [{ previous_ready: null, transitioned: false }] };
      }
      throw new Error(`Unexpected query: ${text}`);
    }
  };
  const snapshot = await persistReadinessSnapshot(client, readyReport(false));
  assert.equal(snapshot.previous_ready, null);
  assert.equal(snapshot.transitioned, false);
});

test('snapshot persistence rejects invalid actor identifiers before SQL', async () => {
  const client = { query: async () => { throw new Error('SQL must not run'); } };
  await assert.rejects(
    persistReadinessSnapshot(client, readyReport(), { userId: 'not-a-user' }),
    (error) => error.category === 'ONBOARDING_READINESS_INVALID'
  );
});
