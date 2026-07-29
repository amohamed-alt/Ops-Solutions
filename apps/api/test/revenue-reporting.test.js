import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRevenueReportingPack,
  getRevenueDrilldown,
  normalizeReportingFilters
} from '../src/revenue-reporting.js';

test('all reporting queries declare optional filter parameter types', async () => {
  const captured = [];
  const postgres = {
    async query(text, values) {
      captured.push({ text, values });
      return { rows: [] };
    }
  };

  await buildRevenueReportingPack(postgres, 'workspace-id', {
    from: '2026-07-01',
    to: '2026-07-22'
  });

  const reportingQueries = captured.filter(({ values }) => values.length === 8);
  assert.ok(reportingQueries.length > 0);
  for (const { text } of reportingQueries) {
    assert.match(text, /\$2::date/);
    assert.match(text, /\$3::date/);
    assert.match(text, /\$6::text/);
    assert.match(text, /\$7::text/);
  }
});

test('normalizes a default 30 day reporting range and dimensions', () => {
  assert.deepEqual(normalizeReportingFilters({ ownerId: ' 77 ', country: ' UAE ' }, new Date('2026-07-22T12:00:00Z')), {
    from: '2026-06-23',
    to: '2026-07-22',
    days: 30,
    ownerId: '77',
    country: 'UAE',
    pipelineId: null,
    stageId: null,
    leadSource: null
  });
});

test('rejects invalid and oversized reporting ranges', () => {
  assert.throws(
    () => normalizeReportingFilters({ from: '2026-08-01', to: '2026-07-01' }),
    (error) => error.statusCode === 400 && error.category === 'INVALID_REPORTING_RANGE'
  );
  assert.throws(
    () => normalizeReportingFilters({ from: '2024-01-01', to: '2026-07-01' }),
    (error) => error.statusCode === 400 && error.category === 'REPORTING_RANGE_TOO_LARGE'
  );
});

test('drilldowns remain tenant scoped and parameterized', async () => {
  let captured;
  const postgres = {
    async query(text, values) {
      captured = { text, values };
      return { rows: [{ record_id: '1', properties: { firstname: 'A' } }] };
    }
  };
  const result = await getRevenueDrilldown(postgres, 'workspace-id', 'untouched-contacts', {
    from: '2026-07-01',
    to: '2026-07-22',
    ownerId: '77',
    limit: 25,
    offset: 50
  });
  assert.equal(result.objectType, 'contacts');
  assert.equal(result.limit, 25);
  assert.equal(result.offset, 50);
  assert.deepEqual(result.results[0].properties, { firstname: 'A' });
  assert.match(captured.text, /r\.workspace_id = \$1/);
  assert.match(captured.text, /LIMIT \$9 OFFSET \$10/);
  assert.equal(captured.values[0], 'workspace-id');
  assert.equal(captured.values[3], '77');
  assert.equal(captured.values[8], 26);
  assert.equal(captured.values[9], 50);
});

test('dimension drilldowns keep raw values parameterized and return display labels', async () => {
  let recordQuery;
  const postgres = {
    async query(text, values) {
      if (text.includes('FROM crm_properties')) {
        return {
          rows: [{
            object_type: 'contacts',
            property_name: 'lifecyclestage',
            label: 'Lifecycle Stage',
            options: [{ value: 'marketingqualifiedlead', label: 'Marketing Qualified Lead' }]
          }]
        };
      }
      if (text.includes('SELECT r.record_id')) {
        recordQuery = { text, values };
        return {
          rows: [{
            record_id: '1',
            properties: { lifecyclestage: 'marketingqualifiedlead' }
          }]
        };
      }
      return { rows: [] };
    }
  };

  const result = await getRevenueDrilldown(
    postgres,
    'workspace-id',
    'contacts-by-lifecycle-stage',
    {
      from: '2026-07-01',
      to: '2026-07-22',
      value: 'marketingqualifiedlead'
    }
  );

  assert.match(recordQuery.text, /lifecyclestage/);
  assert.match(recordQuery.text, /= \$11::text/);
  assert.equal(recordQuery.values[10], 'marketingqualifiedlead');
  assert.equal(result.results[0].properties.lifecyclestage, 'marketingqualifiedlead');
  assert.equal(result.results[0].displayProperties.lifecyclestage, 'Marketing Qualified Lead');
  assert.equal(result.propertyLabels.lifecyclestage, 'Lifecycle Stage');
});

test('reporting pack exposes label-resolved contact and company breakdowns', async () => {
  const postgres = {
    async query(text) {
      if (text.includes('FROM crm_properties')) {
        return {
          rows: [
            {
              object_type: 'contacts',
              property_name: 'hs_lead_status',
              label: 'Lead Status',
              options: [{ value: 'NEW', label: 'New Lead' }]
            },
            {
              object_type: 'contacts',
              property_name: 'lifecyclestage',
              label: 'Lifecycle Stage',
              options: [{ value: 'opportunity', label: 'Opportunity' }]
            },
            {
              object_type: 'companies',
              property_name: 'industry',
              label: 'Industry',
              options: [{ value: 'COMPUTER_SOFTWARE', label: 'Computer Software' }]
            }
          ]
        };
      }
      if (text.includes("'leadStatus'::text")) {
        return {
          rows: [
            { dimension: 'leadStatus', key: 'NEW', value: '14' },
            { dimension: 'lifecycleStage', key: 'opportunity', value: '5' },
            { dimension: 'country', key: 'UAE', value: '9' },
            { dimension: 'createdMonthly', key: '2026-07', value: '7' }
          ]
        };
      }
      if (text.includes("'industry'::text")) {
        return {
          rows: [
            { dimension: 'industry', key: 'COMPUTER_SOFTWARE', value: '8' },
            { dimension: 'country', key: 'UAE', value: '6' },
            { dimension: 'employeeSize', key: '51-200', value: '4' },
            { dimension: 'createdMonthly', key: '2026-07', value: '3' }
          ]
        };
      }
      return { rows: [] };
    }
  };

  const result = await buildRevenueReportingPack(postgres, 'workspace-id', {
    from: '2026-07-01',
    to: '2026-07-22'
  });

  assert.equal(result.crmBreakdowns.contacts.leadStatus.propertyLabel, 'Lead Status');
  assert.equal(result.crmBreakdowns.contacts.leadStatus.rows[0].label, 'New Lead');
  assert.equal(result.crmBreakdowns.contacts.createdMonthly.rows[0].label, 'Jul 2026');
  assert.equal(result.crmBreakdowns.companies.industry.propertyLabel, 'Industry');
  assert.equal(result.crmBreakdowns.companies.industry.rows[0].label, 'Computer Software');
});

test('rejects unknown revenue drilldowns before querying', async () => {
  await assert.rejects(
    () => getRevenueDrilldown({ query: () => assert.fail('database should not be queried') }, 'workspace-id', 'unknown'),
    (error) => error.statusCode === 404 && error.category === 'REPORT_NOT_FOUND'
  );
});
