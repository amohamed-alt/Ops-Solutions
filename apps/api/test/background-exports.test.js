import assert from 'node:assert/strict';
import test from 'node:test';

import {
  enforceBackgroundExportRateLimit,
  normalizeBackgroundExportRequest,
  processBackgroundExportJob,
  registerBackgroundExportRoutes,
  resolveBackgroundExportSelection
} from '../src/background-exports.js';
import { getMigrationRollbackSql } from '../src/database.js';

const EXPORT_ID = '35fc3b20-90d7-4d26-9ad1-23e8c02572c1';
const WORKSPACE_ID = '5839ad18-0d29-4e1b-aa51-47a0b9756aad';
const USER_ID = '9f665079-6a78-4d4c-89dd-8b24bd39e431';
const VIEW_ID = 'c12f156c-a0fd-4a5c-a793-c7f43acd847d';

test('normalizes CSV background export requests and rejects unavailable formats', () => {
  assert.deepEqual(normalizeBackgroundExportRequest({
    format: ' CSV ',
    savedViewId: VIEW_ID,
    viewName: '  GCC   review '
  }), {
    format: 'csv',
    savedViewId: VIEW_ID,
    filters: {},
    viewName: 'GCC review'
  });
  assert.throws(
    () => normalizeBackgroundExportRequest({ format: 'xlsx' }),
    (error) => error.statusCode === 400 && error.category === 'EXPORT_FORMAT_NOT_AVAILABLE'
  );
  assert.throws(() => normalizeBackgroundExportRequest({ savedViewId: 'unsafe' }), /Saved view ID is invalid/);
});

test('resolves saved views with workspace and user isolation at queue time', async () => {
  let captured;
  const result = await resolveBackgroundExportSelection({
    async query(text, values) {
      captured = { text, values };
      return {
        rowCount: 1,
        rows: [{
          id: VIEW_ID,
          name: 'Leadership review',
          date_preset: 'last_7_days',
          filters: { ownerId: '77', country: 'UAE' }
        }]
      };
    }
  }, WORKSPACE_ID, USER_ID, { savedViewId: VIEW_ID }, new Date('2026-07-22T12:00:00Z'));
  assert.match(captured.text, /id = \$1 AND workspace_id = \$2 AND user_id = \$3/);
  assert.deepEqual(captured.values, [VIEW_ID, WORKSPACE_ID, USER_ID]);
  assert.equal(result.viewName, 'Leadership review');
  assert.equal(result.filters.from, '2026-07-16');
  assert.equal(result.filters.to, '2026-07-22');
  assert.equal(result.filters.ownerId, '77');
});

test('enforces an hourly Redis-backed user and workspace limit', async () => {
  let count = 9;
  const redis = {
    multi() {
      return {
        incr() { count += 1; return this; },
        expire() { return this; },
        async exec() { return [[null, count], [null, 1]]; }
      };
    }
  };
  assert.deepEqual(
    await enforceBackgroundExportRateLimit(redis, WORKSPACE_ID, USER_ID, 1_000),
    { limit: 10, remaining: 0 }
  );
  await assert.rejects(
    () => enforceBackgroundExportRateLimit(redis, WORKSPACE_ID, USER_ID, 1_000),
    (error) => error.statusCode === 429 && error.category === 'EXPORT_RATE_LIMITED'
  );
});

test('processes an export idempotently and persists only the scoped artifact', async () => {
  const queries = [];
  const postgres = {
    async query(text, values = []) {
      queries.push({ text, values });
      if (text.includes('SELECT e.*, w.name')) {
        return {
          rowCount: 1,
          rows: [{
            id: EXPORT_ID,
            workspace_id: WORKSPACE_ID,
            requested_by_user_id: USER_ID,
            status: 'queued',
            artifact: null,
            filters: { from: '2026-07-01', to: '2026-07-22' },
            view_name: 'Leadership review',
            workspace_name: 'Acme'
          }]
        };
      }
      return { rowCount: 1, rows: [] };
    }
  };
  const result = await processBackgroundExportJob(postgres, {
    data: { exportJobId: EXPORT_ID, workspaceId: WORKSPACE_ID, userId: USER_ID },
    attemptsMade: 0
  }, {
    async buildExport(_postgres, workspace, filters) {
      assert.deepEqual(workspace, { id: WORKSPACE_ID, name: 'Acme' });
      assert.equal(filters.viewName, 'Leadership review');
      return { csv: '\uFEFFsafe export', fileName: 'acme.csv' };
    }
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.fileSizeBytes, Buffer.byteLength('\uFEFFsafe export'));
  const processingUpdate = queries.find((query) => query.text.includes("SET status = 'processing'"));
  assert.match(processingUpdate.text, /workspace_id = \$3 AND requested_by_user_id = \$4/);
  assert.deepEqual(processingUpdate.values, [EXPORT_ID, 1, WORKSPACE_ID, USER_ID]);
  const finalUpdate = queries.find((query) => query.text.includes("SET status = 'completed'"));
  assert.ok(Buffer.isBuffer(finalUpdate.values[4]));
  assert.equal(finalUpdate.values[5], WORKSPACE_ID);
  assert.equal(finalUpdate.values[6], USER_ID);
});

test('registers viewer-protected queue, status and download routes', async () => {
  const routes = [];
  const redisConnections = [];
  const app = {
    log: { error() {} },
    post(path, options, handler) { routes.push({ method: 'POST', path, options, handler }); },
    get(path, options, handler) { routes.push({ method: 'GET', path, options, handler }); }
  };
  const requireViewer = [() => undefined, () => undefined];
  class FakeQueue {
    async add() {}
    async close() {}
  }
  class FakeWorker {
    on() {}
    async waitUntilReady() {}
    async close() {}
  }
  function connectionFactory(url, options) {
    const connection = { url, options, async quit() {} };
    redisConnections.push(connection);
    return connection;
  }
  const registration = registerBackgroundExportRoutes(app, {
    postgres: { query: async () => ({ rows: [], rowCount: 0 }) },
    redis: {},
    redisUrl: 'redis://example',
    requireViewer,
    requireWorkspace: async () => ({ id: WORKSPACE_ID }),
    writeAudit: async () => undefined,
    QueueClass: FakeQueue,
    WorkerClass: FakeWorker,
    connectionFactory
  });
  assert.deepEqual(routes.map(({ method, path }) => `${method} ${path}`), [
    'POST /api/v1/customer/workspaces/:workspaceId/exports',
    'GET /api/v1/customer/workspaces/:workspaceId/exports',
    'GET /api/v1/customer/workspaces/:workspaceId/exports/:exportId',
    'GET /api/v1/customer/workspaces/:workspaceId/exports/:exportId/download'
  ]);
  assert.ok(routes.every((route) => route.options.preHandler === requireViewer));
  await registration.start();
  assert.equal(redisConnections.length, 2);
  assert.equal(redisConnections[0].url, 'redis://example');
  assert.equal(redisConnections[0].options.maxRetriesPerRequest, 3);
  assert.equal(redisConnections[1].options.maxRetriesPerRequest, null);
  await registration.close();
});

test('background export migration has an explicit rollback', () => {
  assert.match(getMigrationRollbackSql(3), /DROP TABLE IF EXISTS report_export_jobs/);
});
