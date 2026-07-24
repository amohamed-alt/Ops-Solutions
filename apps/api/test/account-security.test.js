import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { classifySessionRisk, ensureAccountSecuritySchema, registerAccountSecurityRoutes, serializeSession, serializeTrustedDevice } from '../src/account-security.js';

const NOW = new Date('2026-07-24T12:00:00Z');

function replyStub() {
  return { statusCode: 200, code(value) { this.statusCode = value; return this; }, send(value) { return value; } };
}

test('serializes sessions and trusted devices without exposing hashes', () => {
  const value = serializeSession({
    session_key: 'a'.repeat(64), current_session: true, known_device: true, explicitly_trusted: true, user_agent: 'Mozilla/5.0 Chrome/140.0',
    created_at: '2026-07-24T01:00:00Z', last_seen_at: '2026-07-24T02:00:00Z', expires_at: '2026-08-24T01:00:00Z', token_hash: 'secret', ip_hash: 'private'
  }, NOW);
  assert.deepEqual(Object.keys(value), ['id', 'current', 'client', 'createdAt', 'lastSeenAt', 'expiresAt', 'familiarDevice', 'explicitlyTrusted', 'risk']);
  assert.equal(value.risk.level, 'trusted');
  assert.doesNotMatch(JSON.stringify(value), /secret|private/);

  const device = serializeTrustedDevice({ id: '22222222-2222-4222-8222-222222222222', label: 'Work laptop', trusted_at: NOW, last_seen_at: NOW, active_sessions: '2', current_device: true, fingerprint_hash: 'hidden' });
  assert.deepEqual(device, { id: '22222222-2222-4222-8222-222222222222', label: 'Work laptop', trustedAt: NOW, lastSeenAt: NOW, activeSessions: 2, current: true });
  assert.doesNotMatch(JSON.stringify(device), /hidden|fingerprint/);
});

test('classifies unfamiliar, trusted, dormant and aged sessions deterministically', () => {
  assert.equal(classifySessionRisk({ current_session: true, known_device: false, explicitly_trusted: false, created_at: '2026-07-23T00:00:00Z', last_seen_at: '2026-07-24T00:00:00Z' }, NOW).level, 'review');
  assert.equal(classifySessionRisk({ current_session: true, known_device: true, explicitly_trusted: true, created_at: '2026-07-23T00:00:00Z', last_seen_at: '2026-07-24T00:00:00Z' }, NOW).reason, 'Current session on a trusted device');
  assert.equal(classifySessionRisk({ current_session: false, known_device: true, created_at: '2026-06-01T00:00:00Z', last_seen_at: '2026-06-20T00:00:00Z' }, NOW).level, 'high');
  assert.equal(classifySessionRisk({ current_session: false, known_device: true, created_at: '2026-01-01T00:00:00Z', last_seen_at: '2026-07-20T00:00:00Z' }, NOW).level, 'review');
});

test('account security schema is idempotent, extensible and replica safe', async () => {
  let sql = '';
  await ensureAccountSecuritySchema({ async query(text) { sql = text; return { rows: [], rowCount: 0 }; } });
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS account_trusted_devices/);
  assert.match(sql, /UNIQUE\(user_id, fingerprint_hash\)/);
  assert.match(sql, /POSITION\('device\.renamed'/);
  assert.match(sql, /POSITION\('device\.revoked'/);
  assert.match(sql, /device\.trusted/);
  assert.match(sql, /device\.renamed/);
  assert.match(sql, /device\.revoked/);
  assert.match(sql, /account_trusted_devices_user_seen_idx/);
  assert.match(sql, /COMMIT;/);
  assert.doesNotMatch(sql, /workspace_id/);
});

test('registers protected account-scoped session and trusted-device routes', async () => {
  const routes = [];
  const queries = [];
  const userId = '11111111-1111-4111-8111-111111111111';
  const deviceId = '22222222-2222-4222-8222-222222222222';
  const postgres = {
    async query(text, values = []) {
      queries.push({ text, values });
      if (text.includes('JOIN app_users')) return { rowCount: 1, rows: [{ token_hash: 'b'.repeat(64), user_id: userId }] };
      if (text.includes('SELECT user_agent') && text.includes('fingerprint_hash')) return { rowCount: 1, rows: [{ user_agent: 'Mozilla/5.0 Chrome/140.0', fingerprint_hash: 'f'.repeat(64) }] };
      if (text.includes('INSERT INTO account_trusted_devices')) return { rowCount: 1, rows: [{ id: deviceId, trusted_at: NOW.toISOString() }] };
      if (text.includes('UPDATE account_trusted_devices')) return { rowCount: 1, rows: [{ id: deviceId, label: 'Work laptop' }] };
      if (text.includes('DELETE FROM account_trusted_devices')) return { rowCount: 1, rows: [{ id: deviceId, label: 'Work laptop' }] };
      return { rowCount: 0, rows: [] };
    }
  };
  const app = {
    get(path, options, handler) { routes.push({ method: 'GET', path, options, handler }); },
    post(path, options, handler) { routes.push({ method: 'POST', path, options, handler }); },
    patch(path, options, handler) { routes.push({ method: 'PATCH', path, options, handler }); },
    delete(path, options, handler) { routes.push({ method: 'DELETE', path, options, handler }); }
  };
  registerAccountSecurityRoutes(app, { postgres });
  assert.deepEqual(routes.map(({ method, path }) => `${method} ${path}`), [
    'GET /api/v1/customer/security',
    'POST /api/v1/customer/security/devices/trust-current',
    'PATCH /api/v1/customer/security/devices/:deviceId',
    'DELETE /api/v1/customer/security/devices/:deviceId',
    'DELETE /api/v1/customer/security/sessions/:sessionId',
    'DELETE /api/v1/customer/security/sessions/stale',
    'DELETE /api/v1/customer/security/sessions'
  ]);
  assert.ok(routes.every((route) => typeof route.options.preHandler === 'function'));

  const request = { headers: { 'x-session-token': 'session-token' }, ip: '127.0.0.1' };
  await routes[0].options.preHandler(request, replyStub());
  const payload = await routes[0].handler(request);
  assert.deepEqual(payload.summary, { active: 0, needsReview: 0, highRisk: 0, unfamiliarDevices: 0, trustedDevices: 0 });
  assert.deepEqual(payload.trustedDevices, []);
  const deviceListQuery = queries.find((entry) => entry.text.includes('FROM account_trusted_devices trusted') && entry.text.includes('active_sessions'));
  assert.match(deviceListQuery.text, /WHERE trusted\.user_id = \$1/);
  assert.match(deviceListQuery.text, /BOOL_OR\(s\.token_hash = \$2/);
  assert.doesNotMatch(deviceListQuery.text, /fingerprint_hash\s+AS/);

  const trustRoute = routes.find((route) => route.method === 'POST');
  await trustRoute.options.preHandler(request, replyStub());
  const trustReply = replyStub();
  const trustPayload = await trustRoute.handler(request, trustReply);
  assert.equal(trustReply.statusCode, 201);
  assert.equal(trustPayload.trusted, true);
  const insert = queries.find((entry) => entry.text.includes('INSERT INTO account_trusted_devices'));
  assert.deepEqual(insert.values, [userId, 'f'.repeat(64), 'Google Chrome']);
  assert.ok(queries.some((entry) => entry.values.includes('device.trusted')));

  const renameRoute = routes.find((route) => route.method === 'PATCH');
  const renameRequest = { ...request, params: { deviceId }, body: { label: '  Work   laptop  ' } };
  await renameRoute.options.preHandler(renameRequest, replyStub());
  const renamePayload = await renameRoute.handler(renameRequest, replyStub());
  assert.deepEqual(renamePayload, { id: deviceId, label: 'Work laptop' });
  const update = queries.find((entry) => entry.text.includes('UPDATE account_trusted_devices'));
  assert.deepEqual(update.values, [deviceId, userId, 'Work laptop']);
  assert.ok(queries.some((entry) => entry.values.includes('device.renamed')));

  const removeRoute = routes.find((route) => route.method === 'DELETE' && route.path.includes('/devices/'));
  const removeRequest = { ...request, params: { deviceId } };
  await removeRoute.options.preHandler(removeRequest, replyStub());
  const removeReply = replyStub();
  await removeRoute.handler(removeRequest, removeReply);
  assert.equal(removeReply.statusCode, 204);
  const deletion = queries.find((entry) => entry.text.includes('DELETE FROM account_trusted_devices'));
  assert.deepEqual(deletion.values, [deviceId, userId]);
  assert.ok(queries.some((entry) => entry.values.includes('device.revoked')));
});

test('trusted device mutations validate identifiers and labels', () => {
  const source = registerAccountSecurityRoutes.toString();
  assert.match(source, /DEVICE_ID_PATTERN/);
  assert.match(source, /normalizeDeviceLabel/);
  assert.match(source, /MAX_DEVICE_LABEL_LENGTH/);
  assert.match(source, /WHERE id = \$1 AND user_id = \$2/);
  assert.match(source, /trusted\.id = \$1 AND trusted\.user_id = \$2/);
});

test('session cleanup remains user scoped and excludes current session', () => {
  const source = registerAccountSecurityRoutes.toString();
  assert.match(source, /COALESCE\(last_seen_at, created_at\)/);
  assert.match(source, /token_hash <> \$2/);
  assert.match(source, /s\.token_hash <> \$3/);
  assert.match(source, /SESSION_KEY_PATTERN/);
  assert.match(source, /sessions\.revoked_others/);
  assert.doesNotMatch(source, /DELETE FROM user_sessions\s*;/);
  assert.equal(createHash('sha256').update('session-token').digest('hex').length, 64);
});
