import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCHEDULED_REPORTS_ROLLBACK_SQL,
  computeNextRun,
  ensureScheduledReportSchema,
  normalizeScheduleRequest,
  registerScheduledReportRoutes
} from '../src/scheduled-reports.js';

const WORKSPACE_ID = '5839ad18-0d29-4e1b-aa51-47a0b9756aad';
const USER_ID = '9f665079-6a78-4d4c-89dd-8b24bd39e431';
const VIEW_ID = 'c12f156c-a0fd-4a5c-a793-c7f43acd847d';

test('normalizes a tenant-safe weekly report schedule', () => {
  const result = normalizeScheduleRequest({
    name: '  Weekly leadership  ', savedViewId: VIEW_ID, frequency: 'weekly', weekday: 1,
    deliveryHour: 9, deliveryMinute: 30, timezone: 'Africa/Cairo',
    recipients: ['CEO@EXAMPLE.COM', 'ops@example.com', 'ceo@example.com'],
    format: 'xlsx', deliveryMode: 'attachment'
  }, new Date('2026-07-23T04:00:00Z'));
  assert.equal(result.name, 'Weekly leadership');
  assert.deepEqual(result.recipients, ['ceo@example.com', 'ops@example.com']);
  assert.equal(result.nextRunAt.toISOString(), '2026-07-27T06:30:00.000Z');
});

test('supports DST-aware daily calculation', () => {
  const next = computeNextRun({ frequency: 'daily', timezone: 'Europe/London', deliveryHour: 8, deliveryMinute: 0 }, new Date('2026-07-23T07:30:00Z'));
  assert.equal(next.toISOString(), '2026-07-24T07:00:00.000Z');
});

test('rejects unsafe recipient, timezone and schedule input', () => {
  assert.throws(() => normalizeScheduleRequest({ savedViewId: VIEW_ID, name: 'x', recipients: ['bad'] }), /at least 2/);
  assert.throws(() => normalizeScheduleRequest({ savedViewId: VIEW_ID, name: 'Report', recipients: ['bad'] }), /valid email/);
  assert.throws(() => normalizeScheduleRequest({ savedViewId: VIEW_ID, name: 'Report', recipients: ['a@example.com'], timezone: 'Invalid\/Zone' }), /Timezone/);
  assert.throws(() => normalizeScheduleRequest({ savedViewId: 'unsafe', name: 'Report', recipients: ['a@example.com'] }), /Saved view ID/);
});

test('scheduled report schema is idempotent and reversible', async () => {
  const queries = [];
  const client = {
    async query(text, values) {
      queries.push({ text, values });
      if (text.includes('SELECT 1 FROM schema_migrations')) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    },
    release() {}
  };
  const result = await ensureScheduledReportSchema({ async connect() { return client; } });
  assert.deepEqual(result, { applied: true, version: 5 });
  assert.ok(queries.some(({ text }) => text.includes('CREATE TABLE IF NOT EXISTS scheduled_report_schedules')));
  assert.ok(queries.some(({ text }) => text.includes('CREATE TABLE IF NOT EXISTS scheduled_report_executions')));
  assert.match(SCHEDULED_REPORTS_ROLLBACK_SQL, /DROP TABLE IF EXISTS scheduled_report_executions/);
});

test('registers viewer reads and admin writes with workspace-scoped SQL', async () => {
  const routes = [];
  const app = {
    log: { error() {} },
    get(path, options, handler) { routes.push({ method: 'GET', path, options, handler }); },
    post(path, options, handler) { routes.push({ method: 'POST', path, options, handler }); },
    patch(path, options, handler) { routes.push({ method: 'PATCH', path, options, handler }); },
    delete(path, options, handler) { routes.push({ method: 'DELETE', path, options, handler }); }
  };
  class FakeQueue { async add() {} async close() {} }
  const connection = { async quit() {} };
  const viewer = [() => undefined];
  const admin = [() => undefined];
  const registration = registerScheduledReportRoutes(app, {
    postgres: { query: async () => ({ rowCount: 0, rows: [] }), connect: async () => ({ query: async () => ({ rowCount: 0, rows: [] }), release() {} }) },
    redisUrl: 'redis://example', requireViewer: viewer, requireAdmin: admin,
    writeAudit: async () => undefined, QueueClass: FakeQueue, connectionFactory: () => connection
  });
  assert.deepEqual(routes.map(({ method, path }) => `${method} ${path}`), [
    'GET /api/v1/customer/workspaces/:workspaceId/report-schedules',
    'POST /api/v1/customer/workspaces/:workspaceId/report-schedules',
    'PATCH /api/v1/customer/workspaces/:workspaceId/report-schedules/:scheduleId',
    'DELETE /api/v1/customer/workspaces/:workspaceId/report-schedules/:scheduleId',
    'GET /api/v1/customer/workspaces/:workspaceId/report-schedules/:scheduleId/executions'
  ]);
  assert.equal(routes[0].options.preHandler, viewer);
  assert.ok(routes.slice(1, 4).every((route) => route.options.preHandler === admin));
  assert.equal(routes[4].options.preHandler, viewer);
  await registration.close();
});
