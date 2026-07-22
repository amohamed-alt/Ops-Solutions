import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeSavedView, registerSavedViewRoutes } from '../src/saved-views.js';

test('normalizes saved reporting filters without accepting arbitrary keys', () => {
  assert.deepEqual(normalizeSavedView({
    name: 'GCC pipeline',
    datePreset: 'custom',
    section: 'pipeline',
    filters: {
      from: '2026-07-01',
      to: '2026-07-22',
      ownerId: '123',
      country: 'Saudi Arabia',
      pipelineId: 'default',
      stageId: 'appointmentscheduled',
      leadSource: 'PAID_SOCIAL',
      injected: 'DROP TABLE'
    },
    isDefault: true
  }), {
    name: 'GCC pipeline',
    datePreset: 'custom',
    section: 'pipeline',
    filters: {
      from: '2026-07-01',
      to: '2026-07-22',
      ownerId: '123',
      country: 'Saudi Arabia',
      pipelineId: 'default',
      stageId: 'appointmentscheduled',
      leadSource: 'PAID_SOCIAL'
    },
    isDefault: true
  });
});

test('relative presets do not persist stale absolute dates', () => {
  const view = normalizeSavedView({
    name: 'Last 30 days',
    datePreset: 'last_30_days',
    filters: { from: '2020-01-01', to: '2020-01-30' }
  });
  assert.equal(view.filters.from, '');
  assert.equal(view.filters.to, '');
});

test('rejects invalid custom ranges and short names', () => {
  assert.throws(() => normalizeSavedView({ name: 'x' }), /between 2 and 100/);
  assert.throws(() => normalizeSavedView({ name: 'Custom', datePreset: 'custom', filters: { from: 'bad', to: '2026-07-22' } }), /valid from and to/);
});

test('registers customer-scoped saved view lifecycle routes', () => {
  const routes = [];
  const app = {
    get(path, options, handler) { routes.push({ method: 'GET', path, options, handler }); },
    post(path, options, handler) { routes.push({ method: 'POST', path, options, handler }); },
    patch(path, options, handler) { routes.push({ method: 'PATCH', path, options, handler }); },
    delete(path, options, handler) { routes.push({ method: 'DELETE', path, options, handler }); }
  };
  const postgres = { query: async () => ({ rowCount: 0, rows: [] }) };
  registerSavedViewRoutes(app, { postgres });
  assert.deepEqual(routes.map((route) => `${route.method} ${route.path}`), [
    'GET /api/v1/customer/workspaces/:workspaceId/saved-views',
    'POST /api/v1/customer/workspaces/:workspaceId/saved-views',
    'PATCH /api/v1/customer/workspaces/:workspaceId/saved-views/:viewId',
    'POST /api/v1/customer/workspaces/:workspaceId/saved-views/:viewId/duplicate',
    'DELETE /api/v1/customer/workspaces/:workspaceId/saved-views/:viewId'
  ]);
  assert.ok(routes.every((route) => typeof route.options.preHandler === 'function'));
});
