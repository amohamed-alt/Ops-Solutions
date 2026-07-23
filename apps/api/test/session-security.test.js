import assert from 'node:assert/strict';
import test from 'node:test';

import {
  enforceSessionCap,
  inspectSessionSecurity,
  normalizeSessionSecurityOptions,
  pruneExpiredSessions,
  revokeUserSessions
} from '../src/session-security.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

test('normalizes bounded session security policy values', () => {
  assert.deepEqual(normalizeSessionSecurityOptions({ maxActiveSessions: 0, staleDays: 999, limit: 0, dryRun: true }), {
    maxActiveSessions: 1,
    staleDays: 365,
    limit: 1,
    dryRun: true
  });
});

test('inspection uses aggregate-only queries and does not return token hashes', async () => {
  const queries = [];
  const postgres = {
    async query(text, values) {
      queries.push({ text, values });
      if (text.includes('total_sessions')) return { rows: [{ total_sessions: 4, active_sessions: 3, expired_sessions: 1, stale_sessions: 0, users_with_active_sessions: 2 }] };
      return { rows: [] };
    }
  };
  const result = await inspectSessionSecurity(postgres, { maxActiveSessions: 5, staleDays: 30 });
  assert.equal(result.summary.active_sessions, 3);
  assert.ok(queries.every(({ text }) => !/password_hash|access_token|refresh_token|properties\b|raw\b/i.test(text)));
  assert.ok(queries.every(({ text }) => !/SELECT\s+.*token_hash/i.test(text)));
});

test('expired session pruning is dry-run by default', async () => {
  const queries = [];
  const postgres = { async query(text) { queries.push(text); return { rowCount: 0, rows: [{ count: 7 }] }; } };
  const result = await pruneExpiredSessions(postgres);
  assert.deepEqual(result, { dryRun: true, deleted: 0, candidates: 7 });
  assert.doesNotMatch(queries[0], /^DELETE/i);
});

test('user revocation is scoped to one user and supports dry-run', async () => {
  let captured;
  const postgres = { async query(text, values) { captured = { text, values }; return { rowCount: 0, rows: [{ count: 3 }] }; } };
  const result = await revokeUserSessions(postgres, USER_ID, { dryRun: true });
  assert.equal(result.candidates, 3);
  assert.match(captured.text, /WHERE user_id = \$1/);
  assert.deepEqual(captured.values, [USER_ID]);
  await assert.rejects(() => revokeUserSessions(postgres, 'not-a-uuid'), /valid user UUID/);
});

test('session cap deletes only overflow hashes for the selected user', async () => {
  const queries = [];
  const postgres = {
    async query(text, values) {
      queries.push({ text, values });
      if (text.includes('ORDER BY last_seen_at')) return { rowCount: 2, rows: [{ token_hash: 'a'.repeat(64) }, { token_hash: 'b'.repeat(64) }] };
      return { rowCount: 2, rows: [] };
    }
  };
  const result = await enforceSessionCap(postgres, USER_ID, 2, { dryRun: false });
  assert.equal(result.revoked, 2);
  assert.match(queries[1].text, /user_id = \$1 AND token_hash = ANY/);
  assert.equal(queries[1].values[0], USER_ID);
});
