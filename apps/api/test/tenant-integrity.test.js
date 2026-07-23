import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeTenantAuditOptions,
  runTenantIntegrityAudit,
  tenantAuditExitCode,
  TENANT_INTEGRITY_CHECKS
} from '../src/tenant-integrity.js';

const WORKSPACE_ID = '5839ad18-0d29-4e1b-aa51-47a0b9756aad';

test('normalizes bounded audit options', () => {
  assert.deepEqual(normalizeTenantAuditOptions({ workspaceId: ` ${WORKSPACE_ID} `, limit: 9999, staleHours: 0 }), {
    workspaceId: WORKSPACE_ID,
    limit: 500,
    staleHours: 1
  });
  assert.deepEqual(normalizeTenantAuditOptions(), { workspaceId: null, limit: 100, staleHours: 24 });
});

test('all mutable-domain checks are parameterized and workspace scoped where applicable', () => {
  assert.ok(TENANT_INTEGRITY_CHECKS.length >= 8);
  for (const check of TENANT_INTEGRITY_CHECKS) {
    assert.match(check.sql, /LIMIT \$2/);
    assert.doesNotMatch(check.sql, /SELECT \*/);
    assert.doesNotMatch(check.sql, /DELETE|UPDATE|INSERT|DROP|TRUNCATE/i);
    if (check.key !== 'duplicate_portal_connections') {
      assert.match(check.sql, /\$1::uuid IS NULL/);
    }
  }
});

test('returns a healthy fleet report when every integrity query is empty', async () => {
  const calls = [];
  const report = await runTenantIntegrityAudit({
    async query(text, values) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 };
    }
  }, { workspaceId: WORKSPACE_ID, limit: 25, staleHours: 12 });

  assert.equal(report.status, 'healthy');
  assert.equal(report.summary.failed, 0);
  assert.equal(tenantAuditExitCode(report), 0);
  assert.ok(calls.every((call) => call.values[0] === WORKSPACE_ID));
  assert.ok(calls.every((call) => call.values[1] === 25));
  assert.ok(calls.every((call) => call.values[2] === 12));
});

test('classifies warning findings as degraded and removes raw CRM properties', async () => {
  const report = await runTenantIntegrityAudit({
    async query(text) {
      if (text.includes('crm_record_associations')) {
        return {
          rows: [{
            entity_id: 'contacts:1->companies:2',
            workspace_id: WORKSPACE_ID,
            raw: { secret: 'must-not-appear' },
            property_name: 'safe_property_name'
          }]
        };
      }
      return { rows: [] };
    }
  });

  assert.equal(report.status, 'degraded');
  assert.equal(tenantAuditExitCode(report), 2);
  const finding = report.results.find((item) => item.key === 'orphaned_associations');
  assert.equal(finding.count, 1);
  assert.equal(finding.samples[0].workspaceId, WORKSPACE_ID);
  assert.deepEqual(finding.samples[0].metadata.raw, { secret: 'must-not-appear' });
});

test('treats missing optional feature tables as not applicable', async () => {
  const report = await runTenantIntegrityAudit({
    async query(text) {
      if (text.includes('hubspot_webhook_events')) {
        const error = new Error('relation does not exist');
        error.code = '42P01';
        throw error;
      }
      return { rows: [] };
    }
  });
  const webhook = report.results.find((item) => item.key === 'stale_processing_webhooks');
  assert.equal(webhook.status, 'not_applicable');
  assert.equal(report.status, 'healthy');
});
