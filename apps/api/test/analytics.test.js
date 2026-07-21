import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AnalyticsDefinitionError,
  compileDrilldownQuery,
  compileMetricQuery,
  indexTemplate
} from '../src/analytics.js';
import { sdrDashboardTemplate } from '../src/templates/sdr-dashboard.js';

const template = indexTemplate(sdrDashboardTemplate);
const mappings = {
  lead_quality: {
    propertyName: 'lead_tier',
    valueMapping: {
      'Tier 1': 'highest',
      'Tier 2': 'medium',
      'Tier 3': 'lowest'
    }
  }
};

test('compiles semantic mapping without hardcoding client values', () => {
  const query = compileMetricQuery({
    workspaceId: '11111111-1111-4111-8111-111111111111',
    definition: template.metrics.high_priority_contacts,
    mappings,
    virtualProperties: template.virtualProperties
  });

  assert.match(query.text, /r\.properties ->> \$3/);
  assert.match(query.text, /IN \(\$4\)/);
  assert.deepEqual(query.values, [
    '11111111-1111-4111-8111-111111111111',
    'contacts',
    'lead_tier',
    'Tier 1'
  ]);
});

test('compiles virtual property filters recursively', () => {
  const query = compileMetricQuery({
    workspaceId: '11111111-1111-4111-8111-111111111111',
    definition: template.metrics.untouched_contacts,
    mappings,
    virtualProperties: template.virtualProperties
  });

  assert.match(query.text, /notes_last_contacted/);
  assert.match(query.text, /createdate/);
  assert.match(query.text, /INTERVAL '1 day'/);
  assert.equal(query.values.at(-1), 2);
});

test('compiles numeric sum safely', () => {
  const query = compileMetricQuery({
    workspaceId: '11111111-1111-4111-8111-111111111111',
    definition: template.metrics.open_pipeline,
    mappings,
    virtualProperties: template.virtualProperties
  });

  assert.match(query.text, /COALESCE\(SUM\(CASE WHEN/);
  assert.ok(query.values.includes('amount'));
});

test('caps drill-down pagination', () => {
  const query = compileDrilldownQuery({
    workspaceId: '11111111-1111-4111-8111-111111111111',
    objectType: 'contacts',
    filters: { field: 'country', operator: 'equals', value: 'Saudi Arabia' },
    limit: 9999,
    offset: -4
  });

  assert.equal(query.limit, 200);
  assert.equal(query.offset, 0);
  assert.equal(query.values.at(-2), 200);
  assert.equal(query.values.at(-1), 0);
});

test('rejects unsafe CRM property identifiers', () => {
  assert.throws(
    () => compileMetricQuery({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      definition: {
        objectType: 'deals',
        aggregation: 'sum',
        field: "amount') DROP TABLE workspaces; --"
      }
    }),
    AnalyticsDefinitionError
  );
});

test('requires approved semantic mappings', () => {
  assert.throws(
    () => compileMetricQuery({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      definition: template.metrics.high_priority_contacts,
      mappings: {},
      virtualProperties: template.virtualProperties
    }),
    /Semantic field is not mapped/
  );
});
