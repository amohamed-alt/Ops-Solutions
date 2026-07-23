import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeRevenueReportScope,
  registerRevenueReportingRoutes
} from '../src/scoped-revenue-reporting.js';

function createApp() {
  const routes = new Map();
  return {
    routes,
    get(path, options, handler) {
      routes.set(path, { options, handler });
    }
  };
}

function emptyPostgres() {
  return {
    async query() {
      return { rows: [], rowCount: 0 };
    }
  };
}

test('normalizes progressive report scopes safely', () => {
  assert.equal(normalizeRevenueReportScope('core'), 'core');
  assert.equal(normalizeRevenueReportScope('operating'), 'operating');
  assert.equal(normalizeRevenueReportScope('full'), 'full');
  assert.equal(normalizeRevenueReportScope('unexpected'), 'full');
  assert.equal(normalizeRevenueReportScope(null), 'full');
});

test('core reports return without waiting for operating reports', async () => {
  const app = createApp();
  registerRevenueReportingRoutes(app, {
    postgres: emptyPostgres(),
    requireAdmin: async () => undefined,
    requireWorkspace: async (id) => ({ id, name: 'Workspace' })
  });

  const route = app.routes.get('/api/v1/workspaces/:workspaceId/analytics/revenue');
  assert.ok(route);
  const result = await route.handler({
    params: { workspaceId: 'workspace-id' },
    query: { scope: 'core', from: '2026-07-01', to: '2026-07-24' }
  });

  assert.equal(result.scope, 'core');
  assert.equal(result.workspace.id, 'workspace-id');
  assert.equal(result.report.operatingReports, undefined);
  assert.ok(result.report.overview);
});

test('operating scope returns only the advanced report payload', async () => {
  const app = createApp();
  registerRevenueReportingRoutes(app, {
    postgres: emptyPostgres(),
    requireAdmin: async () => undefined,
    requireWorkspace: async (id) => ({ id, name: 'Workspace' })
  });

  const route = app.routes.get('/api/v1/workspaces/:workspaceId/analytics/revenue');
  const result = await route.handler({
    params: { workspaceId: 'workspace-id' },
    query: { scope: 'operating', from: '2026-07-01', to: '2026-07-24' }
  });

  assert.equal(result.scope, 'operating');
  assert.ok(result.report.operatingReports);
  assert.equal(result.report.overview, undefined);
  assert.equal(result.report.filters.from, '2026-07-01');
});
