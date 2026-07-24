import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateWorkspaceOnboardingReadiness,
  summarizeReadiness
} from '../src/onboarding-readiness.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
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
