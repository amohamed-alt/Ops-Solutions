import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ensureWorkspacePreferencesSchema,
  normalizeWorkspacePreferences,
  registerWorkspacePreferencesRoutes
} from '../src/workspace-preferences.js';

test('normalizes safe workspace branding and localization values', () => {
  assert.deepEqual(normalizeWorkspacePreferences({
    name: '  Acme   Gulf  ',
    currency: 'aed',
    timezone: 'Asia/Dubai',
    locale: 'ar-AE',
    appearance: 'DARK',
    accentColor: '#12ABef',
    logoUrl: 'https://cdn.example.com/logo.png'
  }), {
    name: 'Acme Gulf',
    currency: 'AED',
    timezone: 'Asia/Dubai',
    locale: 'ar-AE',
    appearance: 'dark',
    accentColor: '#12abef',
    logoUrl: 'https://cdn.example.com/logo.png'
  });
});

test('rejects unsafe or invalid preference values', () => {
  assert.throws(() => normalizeWorkspacePreferences({ currency: 'US' }), /three-letter ISO code/);
  assert.throws(() => normalizeWorkspacePreferences({ timezone: 'Mars/Olympus' }), /not supported/);
  assert.throws(() => normalizeWorkspacePreferences({ accentColor: 'red' }), /six-digit hex/);
  assert.throws(() => normalizeWorkspacePreferences({ logoUrl: 'http://example.com/logo.png' }), /HTTPS URL/);
  assert.throws(() => normalizeWorkspacePreferences({ logoUrl: 'https://user:pass@example.com/logo.png' }), /credential-free/);
});

test('creates an idempotent tenant-owned preferences schema', async () => {
  const queries = [];
  await ensureWorkspacePreferencesSchema({ async query(text) { queries.push(text); } });
  assert.equal(queries.length, 1);
  assert.match(queries[0], /CREATE TABLE IF NOT EXISTS workspace_preferences/);
  assert.match(queries[0], /workspace_id UUID PRIMARY KEY REFERENCES workspaces/);
  assert.match(queries[0], /ON DELETE CASCADE/);
  assert.match(queries[0], /CHECK \(appearance IN/);
});

test('registers public password recovery plus viewer reads and server-enforced admin writes', async () => {
  const routes = [];
  const app = {
    get(path, options, handler) { routes.push({ method: 'GET', path, options, handler }); },
    put(path, options, handler) { routes.push({ method: 'PUT', path, options, handler }); },
    post(path, options, handler) {
      if (typeof options === 'function') routes.push({ method: 'POST', path, options: null, handler: options });
      else routes.push({ method: 'POST', path, options, handler });
    }
  };
  const requireViewer = [() => undefined, () => undefined];
  const postgres = { async query() { return { rowCount: 1, rows: [{ workspace_id: 'w', name: 'Acme', slug: 'acme' }] }; } };
  registerWorkspacePreferencesRoutes(app, {
    postgres,
    withTransaction: async (handler) => handler(postgres),
    requireViewer,
    writeAudit: async () => undefined
  });
  assert.deepEqual(routes.map((route) => `${route.method} ${route.path}`), [
    'POST /api/v1/auth/password/forgot',
    'POST /api/v1/auth/password/reset',
    'GET /api/v1/customer/workspaces/:workspaceId/preferences',
    'PUT /api/v1/customer/workspaces/:workspaceId/preferences'
  ]);
  const protectedRoutes = routes.filter((route) => route.path.includes('/customer/workspaces/'));
  assert.ok(protectedRoutes.every((route) => route.options.preHandler === requireViewer));
  const put = routes.find((route) => route.method === 'PUT');
  const reply = { status: 200, code(value) { this.status = value; return this; }, send(payload) { this.payload = payload; return payload; } };
  await put.handler({ workspaceMembership: { role: 'viewer' }, params: { workspaceId: 'w' } }, reply);
  assert.equal(reply.status, 403);
  assert.equal(reply.payload.error, 'workspace_role_required');
});
