import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ensureOpsActionsSchema,
  getOpsActionsCapabilities,
  registerOpsActionsRoutes
} from '../src/ops-actions.js';

test('ops actions schema creates review markers with tenant isolation', async () => {
  let schemaSql = '';
  await ensureOpsActionsSchema({
    async query(text) {
      schemaSql += text;
      return { rows: [], rowCount: 0 };
    }
  });

  assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS ops_record_reviews/);
  assert.match(schemaSql, /workspace_id UUID NOT NULL REFERENCES workspaces/);
  assert.match(schemaSql, /PRIMARY KEY \(workspace_id, object_type, record_id\)/);
  assert.match(schemaSql, /reviewed_by UUID REFERENCES app_users/);
});

test('ops actions register admin-protected write routes', () => {
  const routes = [];
  const app = Object.fromEntries(['get', 'post', 'patch', 'put', 'delete'].map((method) => [method, (path, options, handler) => {
    routes.push({ method, path, options: typeof options === 'function' ? null : options, handler: typeof options === 'function' ? options : handler });
  }]));
  const requireAdmin = [() => undefined, () => undefined];

  registerOpsActionsRoutes(app, {
    postgres: { async query() { return { rows: [], rowCount: 0 }; } },
    requireAdmin,
    writeAudit: async () => undefined
  });

  assert.deepEqual(routes.map(({ method, path }) => `${method.toUpperCase()} ${path}`), [
    'GET /api/v1/customer/workspaces/:workspaceId/actions/capabilities',
    'POST /api/v1/customer/workspaces/:workspaceId/actions/tasks',
    'PATCH /api/v1/customer/workspaces/:workspaceId/actions/contacts/:contactId/lifecycle-stage',
    'POST /api/v1/customer/workspaces/:workspaceId/actions/records/reviewed'
  ]);
  assert.ok(routes.every((route) => route.options.preHandler === requireAdmin));
});

test('ops actions expose the requested write capability names without database access', () => {
  const disconnected = getOpsActionsCapabilities(null);
  assert.equal(disconnected.can.createTask, false);
  assert.equal(disconnected.can.updateLifecycleStage, false);
  assert.equal(disconnected.can.markReviewed, true);
  assert.deepEqual(disconnected.requiredScopes.createTask, ['crm.objects.tasks.write']);
  assert.deepEqual(disconnected.requiredScopes.updateLifecycleStage, ['crm.objects.contacts.write']);

  const connected = getOpsActionsCapabilities({ scopes: ['crm.objects.tasks.write', 'crm.objects.contacts.write'] });
  assert.equal(connected.connected, true);
  assert.equal(connected.can.createTask, true);
  assert.equal(connected.can.updateLifecycleStage, true);
  assert.equal(connected.can.markReviewed, true);
});
