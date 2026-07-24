import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPasswordResetMessage,
  ensurePasswordRecoverySchema,
  registerPasswordRecoveryRoutes
} from '../src/password-recovery.js';

const WORKSPACELESS_USER = '9f665079-6a78-4d4c-89dd-8b24bd39e431';

test('password reset email escapes customer-controlled display names', () => {
  const message = buildPasswordResetMessage({
    displayName: '<img src=x onerror=alert(1)>',
    resetUrl: 'https://ops.example/reset-password?token=safe'
  });
  assert.match(message.subject, /Reset your Ops Solutions password/);
  assert.match(message.text, /expires in 30 minutes/);
  assert.doesNotMatch(message.html, /<img src=x onerror/);
  assert.match(message.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('password recovery schema stores hashes and rate events, never raw tokens', async () => {
  let sql = '';
  await ensurePasswordRecoverySchema({ async query(text) { sql += text; return { rows: [], rowCount: 0 }; } });
  assert.match(sql, /password_reset_tokens/);
  assert.match(sql, /token_hash CHAR\(64\)/);
  assert.match(sql, /password_reset_rate_events/);
  assert.doesNotMatch(sql, /\btoken\s+TEXT\b/i);
});

test('registers public forgot and reset routes', () => {
  const routes = [];
  const app = { post(path, handler) { routes.push({ path, handler }); } };
  registerPasswordRecoveryRoutes(app, {
    postgres: { query: async () => ({ rows: [], rowCount: 0 }) },
    withTransaction: async (handler) => handler({ query: async () => ({ rows: [], rowCount: 0 }) }),
    emailConfig: { configured: false, missing: ['EMAIL_PROVIDER'] }
  });
  assert.deepEqual(routes.map((route) => route.path), [
    '/api/v1/auth/password/forgot',
    '/api/v1/auth/password/reset'
  ]);
});

test('reset transaction revokes every prior session and writes an audit event', async () => {
  const queries = [];
  const routes = new Map();
  const app = { post(path, handler) { routes.set(path, handler); } };
  const postgres = {
    async query(text) {
      if (text.includes('CREATE TABLE')) return { rows: [], rowCount: 0 };
      if (text.includes('password_reset_rate_events')) return { rows: [{ accepted: true }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }
  };
  registerPasswordRecoveryRoutes(app, {
    postgres,
    withTransaction: async (handler) => handler({
      async query(text) {
        queries.push(text);
        if (text.includes('RETURNING user_id')) return { rows: [{ user_id: WORKSPACELESS_USER }], rowCount: 1 };
        if (text.includes('DELETE FROM user_sessions')) return { rows: [], rowCount: 4 };
        return { rows: [], rowCount: 1 };
      }
    }),
    emailConfig: { configured: false, missing: ['EMAIL_PROVIDER'] }
  });
  const reply = { code() { return this; }, send(value) { return value; } };
  const result = await routes.get('/api/v1/auth/password/reset')({
    body: { token: 'secure-token-value', password: 'a-strong-password' },
    ip: '127.0.0.1',
    headers: {}
  }, reply);
  assert.equal(result.reset, true);
  assert.equal(result.sessionsRevoked, 4);
  assert.ok(queries.some((query) => query.includes('DELETE FROM user_sessions WHERE user_id = $1')));
  assert.ok(queries.some((query) => query.includes("'account.password_reset'")));
});
