import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeActivityTrend,
  executeActivityWindowMetric,
  executeLeadStatusDistribution,
  executeOperationalSnapshot,
  getSdrMetric,
  registerAnalyticsRoutes,
  serializeMetricRows
} from '../src/analytics-runtime.js';
import { sdrDashboardTemplate } from '../src/templates/sdr-dashboard.js';

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

test('activity metrics use resilient timestamp and owner fallbacks', async () => {
  let captured;
  const postgres = {
    async query(text, values) {
      captured = { text, values };
      return { rows: [{ group_key: '77', value: '12' }] };
    }
  };

  const result = await executeActivityWindowMetric(postgres, 'workspace-id', {
    objectType: 'calls',
    activityWindowDays: 30,
    groupBy: 'hubspot_owner_id'
  });

  assert.deepEqual(result, [{ key: '77', value: 12 }]);
  assert.deepEqual(captured.values, ['workspace-id', 'calls', 30]);
  assert.match(captured.text, /hs_timestamp/);
  assert.match(captured.text, /hubspot_created_at/);
  assert.match(captured.text, /hs_activity_assigned_to_user_id/);
  assert.match(captured.text, /hs_created_by_user_id/);
});

test('daily execution trend produces a complete date series with numeric values', async () => {
  let captured;
  const postgres = {
    async query(text, values) {
      captured = { text, values };
      return { rows: [{ day: '2026-07-22', calls: '9', meetings: '2', tasks: '7' }] };
    }
  };

  const result = await executeActivityTrend(postgres, 'workspace-id', 21);
  assert.deepEqual(result, [{ day: '2026-07-22', calls: 9, meetings: 2, tasks: 7 }]);
  assert.deepEqual(captured.values, ['workspace-id', 21]);
  assert.match(captured.text, /generate_series/);
  assert.match(captured.text, /FILTER \(WHERE r\.object_type = 'calls'\)/);
});

test('lead status distribution uses HubSpot lead status with lifecycle fallback', async () => {
  let captured;
  const postgres = {
    async query(text) {
      captured = text;
      return { rows: [{ group_key: 'NEW', value: '14' }, { group_key: null, value: '3' }] };
    }
  };

  const result = await executeLeadStatusDistribution(postgres, 'workspace-id');
  assert.deepEqual(result, [{ key: 'NEW', value: 14 }, { key: 'Unassigned', value: 3 }]);
  assert.match(captured, /hs_lead_status/);
  assert.match(captured, /lifecyclestage/);
});

test('operational snapshot exposes production task and deal controls as numbers', async () => {
  const postgres = {
    async query(text) {
      assert.match(text, /high_priority_tasks/);
      assert.match(text, /no_next_activity/);
      return {
        rows: [{
          total_companies: '18',
          open_tasks: '33',
          open_deals: '7',
          missing_owner: '4',
          tasks_due_today: '5',
          overdue_tasks: '9',
          high_priority_tasks: '3',
          no_next_activity: '2'
        }]
      };
    }
  };

  assert.deepEqual(await executeOperationalSnapshot(postgres, 'workspace-id'), {
    totalCompanies: 18,
    openTasks: 33,
    openDeals: 7,
    missingOwner: 4,
    tasksDueToday: 5,
    overdueTasks: 9,
    highPriorityTasks: 3,
    noNextActivity: 2
  });
});

test('stale and untouched cohorts are mutually exclusive', () => {
  const untouched = sdrDashboardTemplate.virtualProperties.find((item) => item.key === 'untouched_contact');
  const stale = sdrDashboardTemplate.virtualProperties.find((item) => item.key === 'stale_contact');
  const actionMetric = sdrDashboardTemplate.metrics.find((item) => item.key === 'contacts_needing_action');

  assert.ok(untouched.rule.conditions.some((condition) => condition.operator === 'missing'));
  assert.ok(stale.rule.conditions.some((condition) => condition.operator === 'exists'));
  assert.equal(actionMetric.filters.operator, 'OR');
  assert.equal(sdrDashboardTemplate.version, 3);
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
