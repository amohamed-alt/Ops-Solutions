import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAPPING_HISTORY_ROLLBACK_SQL,
  confidenceBand,
  ensureMappingWizardSchema,
  mappingDependencies,
  normalizeValueMapping,
  registerMappingWizardRoutes
} from '../src/mapping-wizard.js';

const WORKSPACE_ID = '5839ad18-0d29-4e1b-aa51-47a0b9756aad';

test('classifies mapping confidence without auto-approving low confidence candidates', () => {
  assert.equal(confidenceBand(0.81), 'high');
  assert.equal(confidenceBand(0.55), 'medium');
  assert.equal(confidenceBand(0.5499), 'low');
  assert.equal(confidenceBand(null), 'low');
});

test('normalizes bounded value mappings and rejects unsafe shapes', () => {
  assert.deepEqual(normalizeValueMapping({
    ' Rank A ': ' highest ',
    'Rank B': 'medium',
    empty: '',
    '': 'ignored'
  }), {
    'Rank A': 'highest',
    'Rank B': 'medium'
  });
  assert.equal(normalizeValueMapping(undefined), null);
  assert.throws(() => normalizeValueMapping([]), /must be an object/);
  assert.throws(
    () => normalizeValueMapping(Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`value-${index}`, 'target']))),
    /cannot contain more than 100/
  );
});

test('exposes report dependencies for semantic fields', () => {
  assert.ok(mappingDependencies('lead_quality').includes('Priority lead queues'));
  assert.deepEqual(mappingDependencies('unknown_semantic_field'), ['Custom reporting and filters']);
});

test('mapping history schema is versioned, idempotent and reversible', async () => {
  const queries = [];
  let migrationExists = false;
  const client = {
    async query(text, values = []) {
      queries.push({ text, values });
      if (text.includes('SELECT 1 FROM schema_migrations')) {
        return { rowCount: migrationExists ? 1 : 0, rows: migrationExists ? [{ exists: 1 }] : [] };
      }
      if (text.includes('INSERT INTO schema_migrations')) migrationExists = true;
      return { rowCount: 0, rows: [] };
    },
    release() {}
  };
  const postgres = { async connect() { return client; } };
  assert.deepEqual(await ensureMappingWizardSchema(postgres), { applied: true, version: 4 });
  assert.deepEqual(await ensureMappingWizardSchema(postgres), { applied: false, version: 4 });
  assert.ok(queries.some(({ text }) => text.includes('CREATE TABLE IF NOT EXISTS property_mapping_versions')));
  assert.ok(queries.some(({ text, values }) => text.includes('INSERT INTO schema_migrations') && values[0] === 4));
  assert.match(MAPPING_HISTORY_ROLLBACK_SQL, /DROP TABLE IF EXISTS property_mapping_versions/);
});

test('registers viewer reads and admin-only mapping mutations', () => {
  const routes = [];
  const app = {
    get(path, options, handler) { routes.push({ method: 'GET', path, options, handler }); },
    put(path, options, handler) { routes.push({ method: 'PUT', path, options, handler }); },
    post(path, options, handler) { routes.push({ method: 'POST', path, options, handler }); },
    delete(path, options, handler) { routes.push({ method: 'DELETE', path, options, handler }); }
  };
  const requireViewer = [() => undefined, () => undefined];
  const requireAdmin = [() => undefined, () => undefined];
  registerMappingWizardRoutes(app, {
    postgres: { query: async () => ({ rowCount: 0, rows: [] }) },
    withTransaction: async (handler) => handler({ query: async () => ({ rowCount: 0, rows: [] }) }),
    requireViewer,
    requireAdmin,
    writeAudit: async () => undefined
  });

  assert.deepEqual(routes.map(({ method, path }) => `${method} ${path}`), [
    'GET /api/v1/customer/workspaces/:workspaceId/mapping-wizard',
    'GET /api/v1/customer/workspaces/:workspaceId/mapping-wizard/:semanticKey/:objectType/history',
    'PUT /api/v1/customer/workspaces/:workspaceId/mapping-wizard/:semanticKey/:objectType',
    'POST /api/v1/customer/workspaces/:workspaceId/mapping-wizard/:semanticKey/:objectType/rollback/:versionId',
    'DELETE /api/v1/customer/workspaces/:workspaceId/mapping-wizard/:semanticKey/:objectType'
  ]);
  assert.equal(routes[0].options.preHandler, requireViewer);
  assert.equal(routes[1].options.preHandler, requireViewer);
  assert.ok(routes.slice(2).every((route) => route.options.preHandler === requireAdmin));
  assert.ok(routes.every((route) => route.path.includes(':workspaceId')));
});

test('history queries remain workspace scoped', async () => {
  const routes = [];
  const calls = [];
  const app = {
    get(path, options, handler) { routes.push({ method: 'GET', path, options, handler }); },
    put() {}, post() {}, delete() {}
  };
  registerMappingWizardRoutes(app, {
    postgres: {
      async query(text, values) {
        calls.push({ text, values });
        return { rowCount: 0, rows: [] };
      }
    },
    withTransaction: async () => undefined,
    requireViewer: [],
    requireAdmin: [],
    writeAudit: async () => undefined
  });
  const history = routes.find((route) => route.path.endsWith('/history'));
  await history.handler({
    params: { workspaceId: WORKSPACE_ID, semanticKey: 'lead_quality', objectType: 'contacts' },
    query: { limit: 25 }
  });
  assert.match(calls[0].text, /v\.workspace_id = \$1 AND v\.semantic_key = \$2 AND v\.object_type = \$3/);
  assert.deepEqual(calls[0].values, [WORKSPACE_ID, 'lead_quality', 'contacts', 25]);
});
