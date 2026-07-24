import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ensureOperationalAlertSchema,
  registerOperationalAlertRoutes
} from '../src/operational-alerts.js';

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
  const routes = new Set();
  const add = (method) => (path) => routes.add(`${method} ${path}`);
  return { routes, get: add('GET'), post: add('POST'), patch: add('PATCH'), delete: add('DELETE') };
}

test('alert migration creates bounded rules and durable event history', async () => {
  const postgres = migrationPostgres();
  const result = await ensureOperationalAlertSchema(postgres);
  assert.equal(result.version, 32);
  const sql = postgres.queries.map((entry) => entry.sql).join('\n');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS operational_alert_rules/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS operational_alert_events/);
  assert.match(sql, /evaluation_interval_minutes BETWEEN 5 AND 1440/);
  assert.match(sql, /cooldown_minutes BETWEEN 15 AND 10080/);
  assert.match(sql, /operational_alert_rules_due_idx/);
});

test('registers tenant-scoped alert CRUD and test routes', () => {
  const app = routeApp();
  registerOperationalAlertRoutes(app, {
    postgres: {},
    requireViewer: async () => undefined,
    writeAudit: async () => undefined
  });
  for (const route of [
    'GET /api/v1/customer/workspaces/:workspaceId/alerts',
    'POST /api/v1/customer/workspaces/:workspaceId/alerts',
    'PATCH /api/v1/customer/workspaces/:workspaceId/alerts/:ruleId',
    'DELETE /api/v1/customer/workspaces/:workspaceId/alerts/:ruleId',
    'POST /api/v1/customer/workspaces/:workspaceId/alerts/:ruleId/test'
  ]) assert.ok(app.routes.has(route), `Missing ${route}`);
});

test('alert evaluation is replica-safe, cooldown-aware and uses the existing provider adapter', async () => {
  const source = await readFile(new URL('../src/operational-alerts.js', import.meta.url), 'utf8');
  assert.match(source, /FOR UPDATE OF r SKIP LOCKED/);
  assert.match(source, /next_evaluation_at/);
  assert.match(source, /cooldownElapsed/);
  assert.match(source, /notify_on_recovery/);
  assert.match(source, /sendEmail\(config/);
  assert.match(source, /recordBillingUsage/);
  assert.match(source, /workspace_id=\$1/);
  assert.match(source, /MAX_RULES_PER_WORKSPACE = 50/);
  assert.match(source, /MAX_RECIPIENTS = 20/);
  assert.doesNotMatch(source, /RESEND_API_KEY\s*=|POSTMARK_SERVER_TOKEN\s*=|ADMIN_API_KEY|x-admin-key/i);
});

test('commercial onReady lifecycle initializes alert schema after base migrations', async () => {
  const exportsSource = await readFile(new URL('../src/report-exports.js', import.meta.url), 'utf8');
  assert.match(exportsSource, /ensureOperationalAlertSchema/);
  assert.match(exportsSource, /registerOperationalAlertRoutes/);
  assert.match(exportsSource, /addHook\('onReady'/);
});
