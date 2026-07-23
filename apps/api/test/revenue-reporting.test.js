import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRevenueReportingPack,
  getRevenueDrilldown,
  normalizeReportingFilters,
  registerRevenueReportingRoutes
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

test('rejects unknown revenue drilldowns before querying', async () => {
  await assert.rejects(
    () => getRevenueDrilldown({ query: () => assert.fail('database should not be queried') }, 'workspace-id', 'unknown'),
    (error) => error.statusCode === 404 && error.category === 'REPORT_NOT_FOUND'
  );
});

test('registers protected reporting pack and generic drilldown routes', () => {
  const routes = [];
  const app = {
    get(path, options, handler) {
      routes.push({ path, options, handler });
    }
  };
  const requireAdmin = () => undefined;
  registerRevenueReportingRoutes(app, {
    postgres: {},
    requireAdmin,
    requireWorkspace: async () => ({ id: 'workspace-id' })
  });
  assert.deepEqual(routes.map((route) => route.path), [
    '/api/v1/workspaces/:workspaceId/analytics/revenue',
    '/api/v1/workspaces/:workspaceId/analytics/revenue/drilldowns/:reportKey'
  ]);
  assert.ok(routes.every((route) => route.options.preHandler === requireAdmin));
});
