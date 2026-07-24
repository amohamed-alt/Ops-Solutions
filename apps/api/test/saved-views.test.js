import assert from 'node:assert/strict';
import test from 'node:test';

import { getMigrationRollbackSql } from '../src/database.js';
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  normalizeSavedView,
  registerSavedViewRoutes,
  updateSavedView
} from '../src/saved-views.js';

const VIEW_ID = '5e6be741-5fbd-4c48-957d-162ff78578e2';
const viewRow = Object.freeze({
  id: VIEW_ID,
  workspace_id: 'workspace-id',
  name: 'GCC pipeline',
  date_preset: 'last_30_days',
  filters: {
    from: '',
    to: '',
    ownerId: '77',
    country: 'UAE',
    pipelineId: 'sales',
    stageId: '',
    leadSource: ''
  },
  section: 'pipeline',
  widget_configuration: null,
  is_default: true,
  created_at: '2026-07-22T12:00:00.000Z',
  updated_at: '2026-07-22T12:00:00.000Z'
});

test('normalizes saved reporting filters without accepting arbitrary keys', () => {
  assert.deepEqual(normalizeSavedView({
    name: ' GCC   pipeline ',
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
    widgetConfiguration: { hidden: ['country'] },
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
    widgetConfiguration: { hidden: ['country'] },
    isDefault: true
  });
});

test('supports every relative preset without persisting stale absolute dates', () => {
  for (const datePreset of [
    'today', 'yesterday', 'last_7_days', 'last_30_days', 'this_month',
    'previous_month', 'this_quarter', 'this_year'
  ]) {
    const view = normalizeSavedView({
      name: `View ${datePreset}`,
      datePreset,
      filters: { from: '2020-01-01', to: '2020-01-30' }
    });
    assert.equal(view.filters.from, '');
    assert.equal(view.filters.to, '');
  }
});

test('rejects invalid custom dates, ranges, sections, and oversized widget input', () => {
  assert.throws(() => normalizeSavedView({ name: 'x' }), /between 2 and 100/);
  assert.throws(
    () => normalizeSavedView({ name: 'Custom', datePreset: 'custom', filters: { from: 'bad', to: '2026-07-22' } }),
    (error) => error.statusCode === 400 && error.category === 'INVALID_SAVED_VIEW_DATES'
  );
  assert.throws(
    () => normalizeSavedView({ name: 'Custom', datePreset: 'custom', filters: { from: '2026-08-01', to: '2026-07-22' } }),
    /on or before/
  );
  assert.throws(() => normalizeSavedView({ name: 'Unsafe', section: 'sql' }), /supported dashboard section/);
  assert.throws(
    () => normalizeSavedView({ name: 'Large', widgetConfiguration: { value: 'x'.repeat(60_000) } }),
    /too large/
  );
});

test('accepts partial rename and default updates', () => {
  assert.deepEqual(normalizeSavedView({ name: 'Renamed' }, { partial: true }), { name: 'Renamed' });
  assert.deepEqual(normalizeSavedView({ isDefault: true }, { partial: true }), { isDefault: true });
  assert.throws(() => normalizeSavedView({}, { partial: true }), /at least one/);
});

test('lists views with both workspace and user isolation', async () => {
  let captured;
  const result = await listSavedViews({
    async query(text, values) {
      captured = { text, values };
      return { rows: [viewRow] };
    }
  }, 'workspace-id', 'user-id');
  assert.match(captured.text, /workspace_id = \$1 AND user_id = \$2/);
  assert.deepEqual(captured.values, ['workspace-id', 'user-id']);
  assert.equal(result[0].id, VIEW_ID);
  assert.equal(result[0].datePreset, 'last_30_days');
  assert.equal(result[0].isDefault, true);
});

test('creates a default view without affecting another user or workspace', async () => {
  const queries = [];
  const result = await createSavedView({
    async query(text, values) {
      queries.push({ text, values });
      return text.includes('RETURNING id') ? { rows: [viewRow], rowCount: 1 } : { rows: [], rowCount: 1 };
    }
  }, 'workspace-id', 'user-id', {
    name: 'GCC pipeline',
    datePreset: 'last_30_days',
    filters: { ownerId: '77', country: 'UAE', pipelineId: 'sales' },
    section: 'pipeline',
    isDefault: true
  });
  assert.equal(result.name, 'GCC pipeline');
  assert.match(queries[0].text, /workspace_id = \$1 AND user_id = \$2/);
  assert.deepEqual(queries[0].values.slice(0, 2), ['workspace-id', 'user-id']);
  assert.deepEqual(queries[1].values.slice(0, 2), ['workspace-id', 'user-id']);
});

test('updates and deletes only the requesting user view', async () => {
  let updateQuery;
  const updated = await updateSavedView({
    async query(text, values) {
      updateQuery = { text, values };
      return { rows: [{ ...viewRow, name: 'Renamed' }], rowCount: 1 };
    }
  }, 'workspace-id', 'user-id', VIEW_ID, { name: 'Renamed' });
  assert.equal(updated.name, 'Renamed');
  assert.match(updateQuery.text, /id = \$1 AND workspace_id = \$2 AND user_id = \$3/);
  assert.deepEqual(updateQuery.values.slice(0, 3), [VIEW_ID, 'workspace-id', 'user-id']);

  let deleteQuery;
  await deleteSavedView({
    async query(text, values) {
      deleteQuery = { text, values };
      return { rows: [{ id: VIEW_ID, name: 'Renamed', is_default: false }], rowCount: 1 };
    }
  }, 'workspace-id', 'user-id', VIEW_ID);
  assert.match(deleteQuery.text, /id = \$1 AND workspace_id = \$2 AND user_id = \$3/);
  assert.deepEqual(deleteQuery.values, [VIEW_ID, 'workspace-id', 'user-id']);
});

test('registers public recovery plus viewer-protected preferences and saved view lifecycle routes', () => {
  const routes = [];
  const app = Object.fromEntries(['get', 'put', 'post', 'patch', 'delete'].map((method) => [method, (path, options, handler) => {
    routes.push({ method, path, options: typeof options === 'function' ? null : options, handler: typeof options === 'function' ? options : handler });
  }]));
  const requireViewer = [() => undefined, () => undefined];
  registerSavedViewRoutes(app, {
    postgres: { async query() { return { rows: [], rowCount: 0 }; } },
    withTransaction: async (handler) => handler({}),
    requireViewer,
    writeAudit: async () => undefined
  });
  assert.deepEqual(routes.map(({ method, path }) => `${method.toUpperCase()} ${path}`), [
    'POST /api/v1/auth/password/forgot',
    'POST /api/v1/auth/password/reset',
    'GET /api/v1/customer/workspaces/:workspaceId/preferences',
    'PUT /api/v1/customer/workspaces/:workspaceId/preferences',
    'GET /api/v1/customer/workspaces/:workspaceId/saved-views',
    'POST /api/v1/customer/workspaces/:workspaceId/saved-views',
    'PATCH /api/v1/customer/workspaces/:workspaceId/saved-views/:viewId',
    'POST /api/v1/customer/workspaces/:workspaceId/saved-views/:viewId/duplicate',
    'DELETE /api/v1/customer/workspaces/:workspaceId/saved-views/:viewId'
  ]);
  const protectedRoutes = routes.filter((route) => route.path.includes('/customer/workspaces/'));
  assert.ok(protectedRoutes.every((route) => route.options.preHandler === requireViewer));
});

test('saved view database migration has an explicit rollback', () => {
  assert.match(getMigrationRollbackSql(2), /DROP TABLE IF EXISTS saved_reporting_views/);
  assert.equal(getMigrationRollbackSql(999), null);
});
