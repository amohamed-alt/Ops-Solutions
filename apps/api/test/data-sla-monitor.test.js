import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyDataSla,
  ensureDataSlaSchema,
  incidentFingerprint,
  normalizeMonitorOptions,
  transitionIncident
} from '../src/data-sla-monitor.js';

test('normalizes bounded SLA policy and incident actions', () => {
  assert.deepEqual(normalizeMonitorOptions({ action: 'evaluate' }), {
    action: 'evaluate', workspaceId: null, warningMinutes: 90, criticalMinutes: 1440,
    incidentId: null, actor: 'system', note: null
  });
  assert.throws(() => normalizeMonitorOptions({ warningMinutes: 5 }), /between 15 and 1440/);
  assert.throws(() => normalizeMonitorOptions({ warningMinutes: 90, criticalMinutes: 60 }), /greater than/);
  assert.throws(() => normalizeMonitorOptions({ action: 'acknowledge' }), /incidentId is required/);
});

test('classifies healthy, warning, and critical workspaces deterministically', () => {
  const now = new Date('2026-07-23T18:00:00Z');
  const base = {
    connection_status: 'connected', latest_sync_status: 'completed', failed_webhooks_24h: 0,
    pending_mappings: 0, total_records: 100
  };
  assert.equal(classifyDataSla({ ...base, newest_record_sync: '2026-07-23T17:30:00Z' }, { now }).grade, 'healthy');
  const warning = classifyDataSla({ ...base, newest_record_sync: '2026-07-23T15:00:00Z' }, { now });
  assert.equal(warning.grade, 'warning');
  assert.match(warning.breaches[0], /warning freshness/);
  const critical = classifyDataSla({ ...base, connection_status: 'error', newest_record_sync: null }, { now });
  assert.equal(critical.grade, 'critical');
  assert.ok(critical.breaches.includes('HubSpot disconnected'));
});

test('incident fingerprints ignore volatile numeric values and ordering', () => {
  assert.equal(
    incidentFingerprint(['3 failed webhook events in 24h', 'CRM mirror exceeds warning freshness threshold (120m)']),
    incidentFingerprint(['CRM mirror exceeds warning freshness threshold (180m)', '8 failed webhook events in 24h'])
  );
});

test('schema is idempotent, tenant scoped, and indexed for operations', async () => {
  const queries = [];
  await ensureDataSlaSchema({ query: async (sql) => { queries.push(sql); return { rows: [], rowCount: 0 }; } });
  const sql = queries.join('\n');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS data_sla_snapshots/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS data_sla_incidents/);
  assert.match(sql, /workspace_id UUID NOT NULL REFERENCES workspaces/);
  assert.match(sql, /UNIQUE\(workspace_id, fingerprint\)/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS data_sla_incidents_workspace_status_idx/);
});

test('incident transitions remain workspace scoped and parameterized', async () => {
  const calls = [];
  const db = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (text.includes('CREATE TABLE')) return { rows: [], rowCount: 0 };
      return { rows: [{ id: values[0], workspace_id: values[3], status: 'acknowledged' }], rowCount: 1 };
    }
  };
  const result = await transitionIncident(db, {
    action: 'acknowledge', incidentId: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222', actor: 'ops@example.com', note: 'Investigating'
  });
  assert.equal(result.status, 'acknowledged');
  const update = calls.find((call) => call.text.includes('UPDATE data_sla_incidents'));
  assert.match(update.text, /AND workspace_id = \$4/);
  assert.deepEqual(update.values, [
    '11111111-1111-4111-8111-111111111111', 'ops@example.com', 'Investigating',
    '22222222-2222-4222-8222-222222222222'
  ]);
});
