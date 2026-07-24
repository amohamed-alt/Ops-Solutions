import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureAccountSecuritySchema, registerAccountSecurityRoutes, serializeSession } from '../src/account-security.js';

test('serializes sessions without exposing token or IP hashes', () => {
  const value = serializeSession({
    session_key: 'a'.repeat(64), current_session: true, user_agent: 'Mozilla/5.0 Chrome/140.0',
    created_at: '2026-07-24T01:00:00Z', last_seen_at: '2026-07-24T02:00:00Z', expires_at: '2026-08-24T01:00:00Z',
    token_hash: 'secret', ip_hash: 'private'
  });
  assert.deepEqual(Object.keys(value), ['id', 'current', 'client', 'createdAt', 'lastSeenAt', 'expiresAt']);
  assert.equal(value.current, true);
  assert.equal(value.client, 'Google Chrome');
  assert.doesNotMatch(JSON.stringify(value), /secret|private/);
});

test('account security schema is idempotent and user scoped', async () => {
  let sql = '';
  await ensureAccountSecuritySchema({ async query(text) { sql = text; return { rows: [], rowCount: 0 }; } });
  assert.match(sql, /CREATE TABLE IF NOT EXISTS account_security_events/);
  assert.match(sql, /user_id UUID NOT NULL REFERENCES app_users/);
  assert.match(sql, /account_security_events_user_created_idx/);
  assert.doesNotMatch(sql, /workspace_id/);
});

test('registers protected list and revocation routes with scoped SQL', async () => {
  const routes = [];
  const queries = [];
  const postgres = {
    async query(text, values = []) {
      queries.push({ text, values });
      if (text.includes('FROM user_sessions s') && text.includes('JOIN app_users')) {
        return { rowCount: 1, rows: [{ token_hash: 'b'.repeat(64), user_id: '11111111-1111-4111-8111-111111111111' }] };
      }
      return { rowCount: 0, rows: [] };
    }
  };
  const app = {
    get(path, options, handler) { routes.push({ method: 'GET', path, options, handler }); },
    delete(path, options, handler) { routes.push({ method: 'DELETE', path, options, handler }); }
  };
  registerAccountSecurityRoutes(app, { postgres });
  assert.deepEqual(routes.map(({ method, path }) => `${method} ${path}`), [
    'GET /api/v1/customer/security',
    'DELETE /api/v1/customer/security/sessions/:sessionId',
    'DELETE /api/v1/customer/security/sessions'
  ]);
  assert.ok(routes.every((route) => typeof route.options.preHandler === 'function'));

  const list = routes[0];
  const request = { headers: { 'x-session-token': 'session-token' }, ip: '127.0.0.1' };
  const reply = { code() { return this; }, send(value) { return value; } };
  await list.options.preHandler(request, reply);
  await list.handler(request);
  const sessionQuery = queries.find((entry) => entry.text.includes('ORDER BY current_session DESC'));
  assert.match(sessionQuery.text, /WHERE s\.user_id = \$1/);
  assert.doesNotMatch(sessionQuery.text, /SELECT .*token_hash.*user_agent/s);
});

test('individual revocation cannot remove the current session', async () => {
  const source = registerAccountSecurityRoutes.toString();
  assert.match(source, /s\.token_hash <> \$3/);
  assert.match(source, /s\.user_id = \$1/);
  assert.match(source, /SESSION_KEY_PATTERN/);
  assert.match(source, /sessions\.revoked_others/);
});
