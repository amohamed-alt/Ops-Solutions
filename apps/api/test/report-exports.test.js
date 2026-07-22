import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRevenueCsv,
  csvRow,
  enforceCustomerRateLimit,
  registerCustomerReportExportRoutes,
  registerReportExportRoutes,
  resolveDatePreset
} from '../src/report-exports.js';

const report = Object.freeze({
  generatedAt: '2026-07-22T12:00:00.000Z',
  filters: {
    from: '2026-07-01',
    to: '2026-07-22',
    ownerId: '77',
    country: 'UAE',
    leadSource: 'Referral',
    pipelineId: 'sales',
    stageId: 'qualified'
  },
  overview: { contacts: 10, wonRevenue: 5000 },
  comparisons: { contacts: { current: 10, previous: 8, deltaPercent: 25 } },
  activityTrend: [{ day: '2026-07-22', calls: 4, meetings: 2, tasks: 3 }],
  pipelineByStage: [{ pipelineLabel: 'Sales', stageLabel: 'Qualified', deals: 2, amount: 3000 }],
  leadSourcePerformance: [{ key: 'Referral', contacts: 4, contacted: 3, opportunities: 2, won: 1, winRate: 50 }],
  countryDistribution: [{ key: 'UAE', value: 10 }],
  ownerPerformance: [{
    ownerName: 'A User', email: 'user@example.com', calls: 4, meetings: 2, tasks: 3,
    meetingRate: 50, openDeals: 2, openPipeline: 3000, wonRevenue: 5000
  }],
  outcomes: {
    calls: [{ key: 'connected', value: 2 }],
    meetings: [{ key: 'completed', value: 1 }],
    tasks: [{ key: 'completed', value: 3 }]
  },
  attention: { overdueTasks: 1 },
  dataQuality: {
    score: 90,
    fields: [{ key: 'email', complete: 9, missing: 1, percentage: 90 }]
  }
});

test('resolves relative reporting presets at request time', () => {
  assert.deepEqual(resolveDatePreset('last_7_days', { country: 'UAE' }, new Date('2026-07-22T18:00:00Z')), {
    from: '2026-07-16',
    to: '2026-07-22',
    days: 7,
    ownerId: null,
    country: 'UAE',
    pipelineId: null,
    stageId: null,
    leadSource: null
  });
  const previousMonth = resolveDatePreset('previous_month', {}, new Date('2026-07-22T12:00:00.000Z'));
  assert.equal(previousMonth.from, '2026-06-01');
  assert.equal(previousMonth.to, '2026-06-30');
  assert.throws(() => resolveDatePreset('unsafe'), /Unsupported saved-view date preset/);
});

test('escapes CSV content and neutralizes spreadsheet formulas', () => {
  assert.equal(csvRow(['normal', 'with,comma', 'with"quote', '=HYPERLINK("bad")']), 'normal,"with,comma","with""quote","\'=HYPERLINK(""bad"")"');
  assert.equal(csvRow(['+SUM(1,2)', '-10', '@cmd']), '"\'+SUM(1,2)",\'-10,\'@cmd');
  assert.equal(csvRow(['\t=1+1']), "'\t=1+1");
});

test('builds a metadata-rich revenue CSV without internal database IDs', () => {
  const csv = buildRevenueCsv({
    workspace: { id: 'internal-workspace-id', name: 'Acme GCC' },
    report,
    viewName: 'UAE review',
    dataFreshnessAt: new Date('2026-07-22T11:58:00.000Z')
  });
  assert.ok(csv.startsWith('\uFEFFOps Solutions Revenue Intelligence Export'));
  assert.match(csv, /Workspace,Acme GCC/);
  assert.match(csv, /Data freshness,2026-07-22T11:58:00.000Z/);
  assert.match(csv, /Saved view,UAE review/);
  for (const section of [
    'Executive overview', 'Activity trend', 'Pipeline by stage',
    'Lead source performance', 'Owner performance', 'Action queue', 'CRM data quality'
  ]) {
    assert.match(csv, new RegExp(section));
  }
  assert.doesNotMatch(csv, /internal-workspace-id/);
});

test('enforces a Redis-backed per-user and workspace export limit', async () => {
  let count = 0;
  const redis = {
    multi() {
      return {
        incr() { count += 1; return this; },
        expire() { return this; },
        async exec() { return [[null, count], [null, 1]]; }
      };
    }
  };
  for (let request = 1; request <= 5; request += 1) {
    const result = await enforceCustomerRateLimit(redis, 'workspace-id', 'user-id', 1_000);
    assert.equal(result.remaining, 5 - request);
  }
  await assert.rejects(
    () => enforceCustomerRateLimit(redis, 'workspace-id', 'user-id', 1_000),
    (error) => error.statusCode === 429 && error.category === 'EXPORT_RATE_LIMITED'
  );
});

test('registers admin, customer export and self-service workspace routes', () => {
  const routes = [];
  const app = {
    get(path, options, handler) {
      routes.push({ method: 'GET', path, options, handler });
    },
    post(path, options, handler) {
      routes.push({ method: 'POST', path, options, handler });
    }
  };
  const requireAdmin = () => undefined;
  const requireViewer = [() => undefined, () => undefined];
  const common = {
    postgres: {},
    requireWorkspace: async () => ({ id: 'workspace-id', name: 'Workspace' })
  };
  registerReportExportRoutes(app, { ...common, requireAdmin });
  registerCustomerReportExportRoutes(app, {
    ...common,
    redis: {},
    requireViewer,
    writeAudit: async () => undefined
  });
  assert.deepEqual(routes.map((route) => `${route.method} ${route.path}`), [
    'GET /api/v1/workspaces/:workspaceId/analytics/revenue/export.csv',
    'POST /api/v1/customer/workspaces/:workspaceId/companies',
    'GET /api/v1/customer/workspaces/:workspaceId/exports/revenue.csv'
  ]);
  assert.equal(routes[0].options.preHandler, requireAdmin);
  assert.equal(routes[1].options.preHandler, requireViewer);
  assert.equal(routes[2].options.preHandler, requireViewer);
});
