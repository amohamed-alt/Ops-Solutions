import assert from 'node:assert/strict';
import test from 'node:test';

import { classifySessionRisk, ensureAccountSecuritySchema, registerAccountSecurityRoutes, serializeSession } from '../src/account-security.js';

const NOW = new Date('2026-07-24T12:00:00Z');

test('serializes sessions without exposing token or IP hashes', () => {
  const value = serializeSession({
    session_key: 'a'.repeat(64), current_session: true, user_agent: 'Mozilla/5.0 Chrome/140.0',
    created_at: '2026-07-24T01:00:00Z', last_seen_at: '2026-07-24T02:00:00Z', expires_at: '2026-08-24T01:00:00Z',
    token_hash: 'secret', ip_hash: 'private'
  }, NOW);
  assert.deepEqual(Object.keys(value), ['id', 'current', 'client', 'createdAt', 'lastSeenAt', 'expiresAt', 'risk']);
  assert.equal(value.current, true);
  assert.equal(value.client, 'Google Chrome');
  assert.equal(value.risk.level, 'trusted');
  assert.doesNotMatch(JSON.stringify(value), /secret|private/);
});

test('classifies dormant and aged sessions deterministically', () => {
  assert.deepEqual(classifySessionRisk({ current_session: false, created_at: '2026-06-01T00:00:00Z', last_seen_at: '2026-06-20T00:00:00Z' }, NOW), {
    level: 'high', reason: 'Inactive for 34 days', dormantDays: 34
  });
  assert.equal(classifySessionRisk({ current_session: false, created_at: '2026-01-01T00:00:00Z', last_seen_at: '2026-07-20T00:00:00Z' }, NOW).level, 'review');
  assert.equal(classifySessionRisk({ current_session: false, created_at: '2026-07-01T00:00:00Z', last_seen_at: '2026-07-23T00:00:00Z' }, NOW).level, 'normal');
});

test('account security schema is idempotent, extensible and user scoped', async () => {
  let sql = '';
  await ensureAccountSecuritySchema({ async query(text) { sql = text; return { rows: [], rowCount: 0 }; } });
  assert.match(sql, /CREATE TABLE IF NOT EXISTS account_security_events/);
  assert.match(sql, /user_id UUID NOT NULL REFERENCES app_users/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS account_security_events_action_check/);
  assert.match(sql, /sessions\.revoked_stale/);
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
    'DELETE /api/v1/customer/security/sessions/stale',
    'DELETE /api/v1/customer/security/sessions'
  ]);
  assert.ok(routes.every((route) => typeof route.options.preHandler === 'function'));

  const list = routes[0];
  const request = { headers: { 'x-session-token': 'session-token' }, ip: '127.0.0.1' };
  const reply = { code() { return this; }, send(value) { return value; } };
  await list.options.preHandler(request, reply);
  const payload = await list.handler(request);
  assert.deepEqual(payload.summary, { active: 0, needsReview: 0, highRisk: 0 });
  const sessionQuery = queries.find((entry) => entry.text.includes('ORDER BY current_session DESC'));
  assert.match(sessionQuery.text, /WHERE s\.user_id = \$1/);
  assert.match(sessionQuery.text, /digest\(s\.token_hash/);
  assert.doesNotMatch(sessionQuery.text, /AS token_hash|ip_hash/);
});

test('stale cleanup is user scoped, excludes current session and validates age', async () => {
  const source = registerAccountSecurityRoutes.toString();
  assert.match(source, /COALESCE\(last_seen_at, created_at\)/);
  assert.match(source, /token_hash <> \$2/);
  assert.match(source, /user_id = \$1/);
  assert.match(source, /MIN_STALE_DAYS/);
  assert.match(source, /MAX_STALE_DAYS/);
  assert.match(source, /sessions\.revoked_stale/);
});

test('individual revocation cannot remove the current session', async () => {
  const source = registerAccountSecurityRoutes.toString();
  assert.match(source, /s\.token_hash <> \$3/);
  assert.match(source, /s\.user_id = \$1/);
  assert.match(source, /SESSION_KEY_PATTERN/);
  assert.match(source, /sessions\.revoked_others/);
});
