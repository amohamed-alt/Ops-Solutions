import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRevenueReportingPack,
  getRevenueDrilldown
} from '../src/agreed-reporting.js';

function reportingPostgres(mappingRows = []) {
  const captured = [];
  return {
    captured,
    async query(text, values = []) {
      captured.push({ text, values });
      if (/FROM property_mappings/.test(text)) return { rows: mappingRows };
      return { rows: [] };
    }
  };
}

test('adds the agreed operating report pack without removing legacy reports', async () => {
  const postgres = reportingPostgres();
  const report = await buildRevenueReportingPack(postgres, 'workspace-id', {
    from: '2026-07-01',
    to: '2026-07-24',
    country: 'United Arab Emirates',
    pipelineId: 'sales-pipeline'
  });

  assert.equal(report.operatingReports.definitionsVersion, '2026-07-24');
  assert.equal(report.operatingReports.qualityFunnel.status, 'configuration_required');
  assert.equal(report.operatingReports.retention.status, 'configuration_required');
  assert.ok(report.drilldowns.includes('calls'));
  assert.ok(report.drilldowns.includes('connected-calls'));
  assert.ok(report.drilldowns.includes('priority-needs-contact'));
  assert.ok(report.drilldowns.includes('retention-delayed'));

  const correctedActivityQueries = postgres.captured.filter(({ text }) =>
    /ca\.from_object_type = r\.object_type/.test(text) && /da\.from_object_type = r\.object_type/.test(text)
  );
  assert.equal(correctedActivityQueries.length, 2);
  for (const query of correctedActivityQueries) {
    assert.equal(query.values[4], 'United Arab Emirates');
    assert.equal(query.values[5], 'sales-pipeline');
    assert.match(query.text, /\$2::date/);
    assert.match(query.text, /\$3::date/);
    assert.match(query.text, /\$6::text/);
    assert.match(query.text, /\$7::text/);
  }
});

test('uses approved semantic mappings as parameter values rather than SQL identifiers', async () => {
  const mappings = [
    {
      semantic_key: 'lead_quality',
      object_type: 'contacts',
      property_name: 'custom_rank',
      value_mapping: { A: 'highest', B: 'medium', C: 'lowest' }
    },
    {
      semantic_key: 'call_outcome',
      object_type: 'calls',
      property_name: 'custom_call_result',
      value_mapping: { Answered: 'connected' }
    },
    {
      semantic_key: 'meeting_outcome',
      object_type: 'meetings',
      property_name: 'custom_meeting_result',
      value_mapping: { Held: 'completed', Missed: 'no_show' }
    },
    {
      semantic_key: 'renewal_date',
      object_type: 'deals',
      property_name: 'renewal_month',
      value_mapping: {}
    }
  ];
  const postgres = reportingPostgres(mappings);
  const report = await buildRevenueReportingPack(postgres, 'workspace-id', {
    from: '2026-07-01',
    to: '2026-07-24'
  });

  assert.equal(report.operatingReports.qualityFunnel.status, 'ready');
  assert.equal(report.operatingReports.retention.status, 'ready');
  assert.equal(report.operatingReports.mappings.leadQuality.propertyName, 'custom_rank');
  assert.equal(report.operatingReports.mappings.callOutcome.propertyName, 'custom_call_result');

  const parameterizedMappingQueries = postgres.captured.filter(({ text }) => /jsonb_extract_path_text/.test(text));
  assert.ok(parameterizedMappingQueries.length > 0);
  assert.ok(parameterizedMappingQueries.some(({ values }) => values.includes('custom_rank')));
  assert.ok(parameterizedMappingQueries.some(({ values }) => values.includes('renewal_month')));
  assert.ok(parameterizedMappingQueries.every(({ text }) => !text.includes("properties->>'custom_rank'")));
});

test('priority drilldown is tenant scoped, mapped and paginated', async () => {
  const postgres = reportingPostgres([
    {
      semantic_key: 'lead_quality',
      object_type: 'contacts',
      property_name: 'tier_property',
      value_mapping: { tier_a: 'highest', tier_b: 'medium' }
    }
  ]);
  const result = await getRevenueDrilldown(postgres, 'workspace-id', 'priority-needs-contact', {
    from: '2026-07-01',
    to: '2026-07-24',
    ownerId: '77',
    limit: 25,
    offset: 50
  });

  assert.equal(result.objectType, 'contacts');
  assert.equal(result.limit, 25);
  assert.equal(result.offset, 50);
  const query = postgres.captured.at(-1);
  assert.match(query.text, /r\.workspace_id = \$1/);
  assert.match(query.text, /jsonb_extract_path_text\(r\.properties, \$9::text\)/);
  assert.match(query.text, /LIMIT \$11 OFFSET \$12/);
  assert.equal(query.values[0], 'workspace-id');
  assert.equal(query.values[3], '77');
  assert.equal(query.values[8], 'tier_property');
  assert.equal(query.values[10], 26);
  assert.equal(query.values[11], 50);
});

test('sync route wrapper replaces only the two legacy revenue routes', async () => {
  const { readFile } = await import('node:fs/promises');
  const wrapper = await readFile(new URL('../src/sync-operations.js', import.meta.url), 'utf8');
  const base = await readFile(new URL('../src/sync-operations-base.js', import.meta.url), 'utf8');

  assert.match(wrapper, /LEGACY_REVENUE_ROUTES/);
  assert.match(wrapper, /registerBaseSyncOperationsRoutes\(withoutLegacyRevenueRoutes\(app\), dependencies\)/);
  assert.match(wrapper, /registerRevenueReportingRoutes\(app/);
  assert.match(base, /registerAnalyticsRoutes/);
  assert.match(base, /registerReportExportRoutes/);
  assert.doesNotMatch(wrapper, /ADMIN_API_KEY|x-admin-key|access[_-]?token|client[_-]?secret/i);
});
