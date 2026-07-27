import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureOpsActionsSchema, registerOpsActionsRoutes } from '../src/ops-actions.js';

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

test('ops actions expose the requested write capability names', async () => {
  const routes = [];
  const app = { get: (path, options, handler) => routes.push({ path, handler }), post: () => undefined, patch: () => undefined };
  registerOpsActionsRoutes(app, {
    postgres: { async query() { return { rows: [], rowCount: 0 }; } },
    requireAdmin: [],
    writeAudit: async () => undefined
  });

  const capabilitiesRoute = routes.find((route) => route.path.endsWith('/capabilities'));
  assert.ok(capabilitiesRoute);
  const payload = await capabilitiesRoute.handler({ params: { workspaceId: 'missing-workspace' } });
  assert.equal(payload.can.createTask, false);
  assert.equal(payload.can.updateLifecycleStage, false);
  assert.equal(payload.can.markReviewed, true);
  assert.deepEqual(payload.requiredScopes.createTask, ['crm.objects.tasks.write']);
  assert.deepEqual(payload.requiredScopes.updateLifecycleStage, ['crm.objects.contacts.write']);
});
