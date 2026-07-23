import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildObjectReportingDetail,
  buildObjectReportingOverview,
  getObjectReportingDrilldown,
  normalizeObjectType,
  registerObjectReportingRoutes
} from '../src/object-reporting.js';

function emptyPostgres() {
  return {
    async query() {
      return { rows: [], rowCount: 0 };
    }
  };
}

function createApp() {
  const routes = new Map();
  return {
    routes,
    get(path, options, handler) {
      routes.set(path, { options, handler });
    }
  };
}

const range = { from: '2026-07-01', to: '2026-07-24' };

test('normalizes supported HubSpot object types and rejects unknown types', () => {
  assert.equal(normalizeObjectType('Contacts'), 'contacts');
  assert.equal(normalizeObjectType('tickets'), 'tickets');
  assert.throws(
    () => normalizeObjectType('unknown-object'),
    (error) => error?.statusCode === 404 && error?.category === 'OBJECT_REPORT_NOT_FOUND'
  );
});

test('object overview always returns the complete supported object catalog', async () => {
  const report = await buildObjectReportingOverview(emptyPostgres(), 'workspace-id', range);
  assert.equal(report.objects.length, 7);
  assert.deepEqual(
    report.objects.map((row) => row.objectType),
    ['contacts', 'companies', 'deals', 'calls', 'meetings', 'tasks', 'tickets']
  );
  assert.equal(report.objects[0].total, 0);
  assert.equal(report.filters.from, range.from);
});

test('object detail exposes a broad metric pack and drilldown keys', async () => {
  const report = await buildObjectReportingDetail(emptyPostgres(), 'workspace-id', 'deals', range);
  assert.equal(report.objectType, 'deals');
  assert.ok(report.metrics.length >= 10);
  assert.ok(report.metrics.some((metric) => metric.key === 'open-pipeline'));
  assert.ok(report.metrics.some((metric) => metric.key === 'won-revenue'));
  assert.ok(report.drilldowns.includes('missing-owner'));
  assert.equal(report.breakdowns.length, 2);
});

test('object drilldowns are bounded and preserve HubSpot record shape', async () => {
  const drilldown = await getObjectReportingDrilldown(
    emptyPostgres(),
    'workspace-id',
    'contacts',
    'missing-email',
    { ...range, limit: 500, offset: -4 }
  );
  assert.equal(drilldown.limit, 200);
  assert.equal(drilldown.offset, 0);
  assert.equal(drilldown.objectType, 'contacts');
  assert.deepEqual(drilldown.results, []);
  assert.ok(drilldown.columns.includes('email'));
});

test('registers overview, detail and drilldown API routes behind admin access', async () => {
  const app = createApp();
  registerObjectReportingRoutes(app, {
    postgres: emptyPostgres(),
    requireAdmin: async () => undefined,
    requireWorkspace: async (id) => ({ id, name: 'Workspace' })
  });

  const overviewPath = '/api/v1/workspaces/:workspaceId/analytics/objects';
  const detailPath = '/api/v1/workspaces/:workspaceId/analytics/objects/:objectType';
  const drilldownPath = '/api/v1/workspaces/:workspaceId/analytics/objects/:objectType/drilldowns/:reportKey';
  assert.ok(app.routes.has(overviewPath));
  assert.ok(app.routes.has(detailPath));
  assert.ok(app.routes.has(drilldownPath));

  const response = await app.routes.get(overviewPath).handler({
    params: { workspaceId: 'workspace-id' },
    query: range
  });
  assert.equal(response.workspace.id, 'workspace-id');
  assert.equal(response.report.objects.length, 7);
});
