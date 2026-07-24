import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { ensureBillingSchema, registerBillingRoutes } from '../src/billing.js';

function migrationPostgres() {
  const queries = [];
  const client = {
    async query(sql, values = []) {
      queries.push({ sql: String(sql), values });
      if (String(sql).includes('SELECT 1 FROM schema_migrations')) return { rowCount: 0, rows: [] };
      return { rowCount: 0, rows: [] };
    },
    release() {}
  };
  return { queries, async connect() { return client; } };
}

function routeApp() {
  const routes = new Map();
  const hooks = [];
  return {
    routes,
    hooks,
    get(path, options, handler) { routes.set(`GET ${path}`, { options, handler }); },
    post(path, options, handler) { routes.set(`POST ${path}`, { options, handler }); },
    patch(path, options, handler) { routes.set(`PATCH ${path}`, { options, handler }); },
    addHook(name, handler) { hooks.push({ name, handler }); }
  };
}

test('billing migration creates plans subscriptions usage and provider event storage', async () => {
  const postgres = migrationPostgres();
  const result = await ensureBillingSchema(postgres);
  assert.equal(result.version, 30);
  const sql = postgres.queries.map((entry) => entry.sql).join('\n');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS billing_plans/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS workspace_subscriptions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS workspace_usage_monthly/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS billing_provider_events/);
  assert.match(sql, /INSERT INTO workspace_subscriptions/);
  assert.match(sql, /'managed'/);
});

test('billing routes expose read state and admin lifecycle controls without a live provider', () => {
  const app = routeApp();
  registerBillingRoutes(app, {
    postgres: { query: async () => ({ rowCount: 0, rows: [] }) },
    requireViewer: async () => undefined,
    writeAudit: async () => undefined
  });
  assert.ok(app.routes.has('GET /api/v1/customer/workspaces/:workspaceId/billing'));
  assert.ok(app.routes.has('POST /api/v1/customer/workspaces/:workspaceId/billing/start-trial'));
  assert.ok(app.routes.has('PATCH /api/v1/customer/workspaces/:workspaceId/billing/subscription'));
  assert.ok(app.routes.has('POST /api/v1/customer/workspaces/:workspaceId/billing/cancel'));
  assert.ok(app.routes.has('POST /api/v1/customer/workspaces/:workspaceId/billing/reactivate'));
});

test('commercial routes initialize after core migrations and never embed payment credentials', async () => {
  const [billing, exportsSource] = await Promise.all([
    readFile(new URL('../src/billing.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/report-exports.js', import.meta.url), 'utf8')
  ]);
  assert.match(exportsSource, /addHook\('onReady'/);
  assert.match(exportsSource, /ensureBillingSchema/);
  assert.match(exportsSource, /ensureRetentionBudgetSchema/);
  assert.match(billing, /liveCheckoutAvailable:\s*false/);
  assert.match(billing, /PLAN_LIMIT_REACHED/);
  assert.match(billing, /workspace_id=\$1/);
  assert.doesNotMatch(`${billing}\n${exportsSource}`, /STRIPE_SECRET|PAYMOB_SECRET|client[_-]?secret|access[_-]?token/i);
});
