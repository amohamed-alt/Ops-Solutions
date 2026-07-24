import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  normalizeExtendedObjectType
} from '../src/extended-object-reporting.js';
import { registerRevenueReportingRoutes } from '../src/scoped-revenue-reporting.js';

function createApp() {
  const routes = new Map();
  return {
    routes,
    get(path, options, handler) {
      routes.set(path, { options, handler });
    }
  };
}

test('accepts safe standard and custom HubSpot object identifiers', () => {
  assert.equal(normalizeExtendedObjectType('Leads'), 'leads');
  assert.equal(normalizeExtendedObjectType('line_items'), 'line_items');
  assert.equal(normalizeExtendedObjectType('2-123456'), '2-123456');
  assert.throws(() => normalizeExtendedObjectType('../secrets'), /invalid/i);
  assert.throws(() => normalizeExtendedObjectType(''), /invalid/i);
});

test('registers catalog, server search and bounded CSV export routes', () => {
  const app = createApp();
  registerRevenueReportingRoutes(app, {
    postgres: { query: async () => ({ rows: [], rowCount: 0 }) },
    requireAdmin: async () => undefined,
    requireWorkspace: async (id) => ({ id })
  });

  assert.ok(app.routes.has('/api/v1/workspaces/:workspaceId/analytics/extended-objects'));
  assert.ok(app.routes.has('/api/v1/workspaces/:workspaceId/analytics/extended-objects/:objectType'));
  assert.ok(app.routes.has('/api/v1/workspaces/:workspaceId/analytics/extended-objects/:objectType/records/:reportKey'));
  assert.ok(app.routes.has('/api/v1/workspaces/:workspaceId/analytics/extended-objects/:objectType/export/:reportKey.csv'));
});

test('dynamic object SQL stays tenant scoped, parameterized and export bounded', async () => {
  const source = await readFile(new URL('../src/extended-object-reporting.js', import.meta.url), 'utf8');

  assert.match(source, /MAX_EXPORT_ROWS = 25_000/);
  assert.match(source, /r\.workspace_id = \$1/);
  assert.match(source, /r\.object_type = \$2/);
  assert.match(source, /jsonb_extract_path_text\(r\.properties, \$3\)/);
  assert.match(source, /COUNT\(\*\) OVER\(\)/);
  assert.match(source, /properties::text ILIKE/);
  assert.doesNotMatch(source, /ADMIN_API_KEY|x-admin-key|client[_-]?secret|access[_-]?token/i);
});
