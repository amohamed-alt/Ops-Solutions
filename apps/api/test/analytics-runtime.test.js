import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSdrMetric,
  registerAnalyticsRoutes,
  serializeMetricRows
} from '../src/analytics-runtime.js';

test('serializes PostgreSQL aggregate values into JSON numbers', () => {
  assert.equal(serializeMetricRows([{ value: '42' }]), 42);
  assert.equal(serializeMetricRows([{ value: '1234.50' }]), 1234.5);
  assert.equal(serializeMetricRows([]), 0);
});

test('serializes grouped metrics with a stable unassigned bucket', () => {
  assert.deepEqual(serializeMetricRows([
    { group_key: '123', value: '7' },
    { group_key: null, value: '2' }
  ], true), [
    { key: '123', value: 7 },
    { key: 'Unassigned', value: 2 }
  ]);
});

test('rejects unknown dashboard metrics before querying the database', async () => {
  await assert.rejects(
    () => getSdrMetric({ query: () => assert.fail('database should not be queried') }, 'workspace-id', 'missing'),
    (error) => error.statusCode === 404 && error.category === 'METRIC_NOT_FOUND'
  );
});

test('registers protected dashboard, metric and drilldown routes', () => {
  const routes = [];
  const app = {
    get(path, options, handler) {
      routes.push({ path, options, handler });
    }
  };
  const requireAdmin = () => undefined;

  registerAnalyticsRoutes(app, {
    postgres: {},
    requireAdmin,
    requireWorkspace: async () => ({ id: 'workspace-id' })
  });

  assert.deepEqual(routes.map((route) => route.path), [
    '/api/v1/workspaces/:workspaceId/analytics/sdr',
    '/api/v1/workspaces/:workspaceId/analytics/sdr/metrics/:metricKey',
    '/api/v1/workspaces/:workspaceId/analytics/sdr/drilldowns/priority-leads-needing-action'
  ]);
  assert.ok(routes.every((route) => route.options.preHandler === requireAdmin));
});
