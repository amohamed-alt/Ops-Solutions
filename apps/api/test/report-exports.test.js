import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRevenueCsv,
  csvRow,
  registerReportExportRoutes,
  resolveDatePreset
} from '../src/report-exports.js';

test('escapes CSV values and neutralizes spreadsheet formulas', () => {
  assert.equal(csvRow(['plain', 'a,b', 'say "hello"', '=SUM(A1:A2)', '@cmd']), 'plain,"a,b","say ""hello""",\'=SUM(A1:A2),\'@cmd');
});

test('resolves relative date presets deterministically', () => {
  const now = new Date('2026-07-22T12:00:00.000Z');
  assert.deepEqual(resolveDatePreset('last_7_days', { ownerId: '77' }, now), {
    from: '2026-07-16',
    to: '2026-07-22',
    days: 7,
    ownerId: '77',
    country: null,
    pipelineId: null,
    stageId: null,
    leadSource: null
  });
  assert.deepEqual(resolveDatePreset('previous_month', {}, now).from, '2026-06-01');
  assert.deepEqual(resolveDatePreset('previous_month', {}, now).to, '2026-06-30');
});

test('builds an Excel-ready revenue export with all decision sections', () => {
  const report = {
    generatedAt: '2026-07-22T12:00:00.000Z',
    filters: { from: '2026-07-01', to: '2026-07-22', ownerId: null, country: null, leadSource: null, pipelineId: null, stageId: null },
    overview: { calls: 12, wonRevenue: 5000 },
    comparisons: { calls: { current: 12, previous: 8, deltaPercent: 50 } },
    activityTrend: [{ day: '2026-07-22', calls: 4, meetings: 1, tasks: 3 }],
    pipelineByStage: [{ pipelineLabel: 'Sales', stageLabel: 'Qualified', deals: 2, amount: 1000 }],
    leadSourcePerformance: [{ key: 'Organic', contacts: 10, contacted: 8, opportunities: 3, won: 1, winRate: 33.3 }],
    countryDistribution: [{ key: 'Egypt', value: 10 }],
    ownerPerformance: [{ ownerName: 'Owner', email: 'owner@example.com', calls: 4, meetings: 1, tasks: 3, meetingRate: 25, openDeals: 2, openPipeline: 1000, wonRevenue: 500 }],
    outcomes: { calls: [{ key: 'connected', value: 3 }], meetings: [], tasks: [] },
    attention: { overdueTasks: 2 },
    dataQuality: { score: 88, fields: [{ key: 'email', complete: 9, missing: 1, percentage: 90 }] }
  };
  const csv = buildRevenueCsv({ workspace: { name: 'Acme' }, report, viewName: 'Leadership view' });
  for (const section of ['Executive overview', 'Activity trend', 'Pipeline by stage', 'Lead source performance', 'Owner performance', 'Action queue', 'CRM data quality']) {
    assert.match(csv, new RegExp(section));
  }
  assert.match(csv, /Leadership view/);
  assert.ok(csv.startsWith('\uFEFF'));
});

test('registers a protected bounded revenue export endpoint', () => {
  const routes = [];
  const app = { get(path, options, handler) { routes.push({ path, options, handler }); } };
  const requireAdmin = () => undefined;
  registerReportExportRoutes(app, { postgres: {}, requireAdmin, requireWorkspace: async () => ({ id: 'workspace', name: 'Workspace' }) });
  assert.deepEqual(routes.map((route) => route.path), ['/api/v1/workspaces/:workspaceId/analytics/revenue/export.csv']);
  assert.equal(routes[0].options.preHandler, requireAdmin);
});
