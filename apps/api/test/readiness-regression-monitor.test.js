import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyReadinessSnapshot,
  normalizeReadinessIncidentOptions,
  persistWorkspaceState
} from '../src/readiness-regression-monitor.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT_ID = '22222222-2222-4222-8222-222222222222';

function regressionRow(snapshotId = SNAPSHOT_ID) {
  return {
    workspace_id: WORKSPACE_ID,
    snapshot_id: snapshotId,
    created_at: '2026-07-25T00:00:00.000Z'
  };
}

const regressionClassification = {
  ready: false,
  transitionedToBlocked: true,
  severity: 'critical',
  score: 62,
  blockers: 2,
  warnings: 1
};

test('normalizes safe defaults', () => {
  assert.deepEqual(normalizeReadinessIncidentOptions({}), {
    action: 'evaluate',
    workspaceId: null,
    incidentId: null,
    actor: 'system',
    note: null,
    cooldownMinutes: 360,
    limit: 200
  });
});

test('rejects invalid action and unsafe limits', () => {
  assert.throws(() => normalizeReadinessIncidentOptions({ action: 'delete' }), /action must be/);
  assert.throws(() => normalizeReadinessIncidentOptions({ cooldownMinutes: 5 }), /cooldownMinutes/);
  assert.throws(() => normalizeReadinessIncidentOptions({ limit: 1001 }), /limit/);
});

test('requires valid incident and workspace UUID values', () => {
  assert.throws(() => normalizeReadinessIncidentOptions({ workspaceId: 'all' }), /valid UUID/);
  assert.throws(() => normalizeReadinessIncidentOptions({ action: 'acknowledge' }), /incidentId is required/);
  assert.throws(() => normalizeReadinessIncidentOptions({ action: 'resolve', incidentId: 'bad' }), /valid UUID/);
});

test('detects a true ready to blocked regression', () => {
  assert.deepEqual(classifyReadinessSnapshot({
    ready: false,
    transitioned: true,
    previous_ready: true,
    score: 62,
    blockers: 2,
    warnings: 1
  }), regressionClassification);
});

test('does not alert on initial blocked onboarding state', () => {
  const result = classifyReadinessSnapshot({
    ready: false,
    transitioned: false,
    previous_ready: null,
    score: 35,
    blockers: 4,
    warnings: 0
  });
  assert.equal(result.transitionedToBlocked, false);
  assert.equal(result.severity, 'critical');
});

test('classifies recovery snapshots as healthy', () => {
  const result = classifyReadinessSnapshot({
    ready: true,
    transitioned: true,
    previous_ready: false,
    score: 100,
    blockers: 0,
    warnings: 0
  });
  assert.equal(result.ready, true);
  assert.equal(result.transitionedToBlocked, false);
});

test('re-evaluating the same regression snapshot is idempotent', async () => {
  const calls = [];
  const existingIncident = {
    id: '33333333-3333-4333-8333-333333333333',
    workspace_id: WORKSPACE_ID,
    status: 'open',
    severity: 'critical',
    occurrences: 1,
    latest_snapshot_id: SNAPSHOT_ID,
    last_notified_at: null
  };
  const client = {
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      if (sql.startsWith('INSERT INTO readiness_regression_incidents')) return { rowCount: 0, rows: [] };
      if (sql.includes('FROM readiness_regression_incidents') && sql.includes('WHERE workspace_id=$1')) {
        return { rowCount: 1, rows: [existingIncident] };
      }
      return { rowCount: 0, rows: [] };
    },
    release: () => calls.push({ sql: 'release' })
  };

  const result = await persistWorkspaceState(
    { connect: async () => client },
    regressionRow(),
    regressionClassification,
    360
  );

  assert.equal(result.action, 'unchanged');
  assert.equal(result.shouldNotify, false);
  assert.equal(result.incident.occurrences, 1);
  const upsert = calls.find((call) => call.sql.startsWith('INSERT INTO readiness_regression_incidents'));
  assert.match(upsert.sql, /latest_snapshot_id IS DISTINCT FROM EXCLUDED\.latest_snapshot_id/);
  assert.deepEqual(calls.map((call) => call.sql), [
    'BEGIN',
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    upsert.sql,
    calls[3].sql,
    'COMMIT',
    'release'
  ]);
});

test('a different regression snapshot increments and becomes notification eligible', async () => {
  const nextSnapshotId = '44444444-4444-4444-8444-444444444444';
  const client = {
    query: async (sql) => {
      if (sql.startsWith('INSERT INTO readiness_regression_incidents')) {
        return {
          rowCount: 1,
          rows: [{
            id: '33333333-3333-4333-8333-333333333333',
            workspace_id: WORKSPACE_ID,
            status: 'open',
            severity: 'critical',
            occurrences: 2,
            latest_snapshot_id: nextSnapshotId,
            last_notified_at: null
          }]
        };
      }
      return { rowCount: 0, rows: [] };
    },
    release: () => undefined
  };

  const result = await persistWorkspaceState(
    { connect: async () => client },
    regressionRow(nextSnapshotId),
    regressionClassification,
    360
  );

  assert.equal(result.action, 'reopened');
  assert.equal(result.incident.occurrences, 2);
  assert.equal(result.shouldNotify, true);
});
