import assert from 'node:assert/strict';
import test from 'node:test';

import {
  enforceAllSessionCaps,
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

test('inspection uses aggregate-only queries and excludes expired sessions from stale counts', async () => {
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
  assert.match(queries[0].text, /expires_at > NOW\(\).*COALESCE/s);
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

test('user revocation is scoped to one user and validates canonical UUIDs', async () => {
  let captured;
  const postgres = { async query(text, values) { captured = { text, values }; return { rowCount: 0, rows: [{ count: 3 }] }; } };
  const result = await revokeUserSessions(postgres, USER_ID, { dryRun: true });
  assert.equal(result.candidates, 3);
  assert.match(captured.text, /WHERE user_id = \$1/);
  assert.deepEqual(captured.values, [USER_ID]);
  await assert.rejects(() => revokeUserSessions(postgres, '11111111-1111-1111-1111-111111111111'), /valid user UUID/);
});

test('session cap deletes only deterministic overflow hashes for the selected user', async () => {
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
  assert.match(queries[0].text, /token_hash DESC/);
  assert.match(queries[1].text, /user_id = \$1 AND token_hash = ANY/);
  assert.equal(queries[1].values[0], USER_ID);
});

test('fleet cap dry-run returns aggregate candidates without exposing session hashes', async () => {
  let captured;
  const postgres = {
    async query(text, values) {
      captured = { text, values };
      return { rows: [{ candidate_sessions: 12, affected_users: 4 }], rowCount: 1 };
    }
  };
  const result = await enforceAllSessionCaps(postgres, { maxActiveSessions: 5, dryRun: true });
  assert.deepEqual(result, { dryRun: true, cap: 5, candidateSessions: 12, affectedUsers: 4, revoked: 0 });
  assert.match(captured.text, /ROW_NUMBER\(\) OVER/);
  assert.doesNotMatch(JSON.stringify(result), /token_hash/);
});

test('fleet cap apply is bounded, replica-safe and deletes only ranked overflow rows', async () => {
  let captured;
  const postgres = {
    async query(text, values) {
      captured = { text, values };
      return { rows: [{ revoked: 9, affected_users: 3 }], rowCount: 1 };
    }
  };
  const result = await enforceAllSessionCaps(postgres, { maxActiveSessions: 4, limit: 25, dryRun: false });
  assert.deepEqual(result, { dryRun: false, cap: 4, batchLimit: 25, revoked: 9, affectedUsers: 3 });
  assert.match(captured.text, /pg_advisory_xact_lock/);
  assert.match(captured.text, /u\.status = 'active'/);
  assert.match(captured.text, /LIMIT \$2/);
  assert.match(captured.text, /DELETE FROM user_sessions/);
  assert.deepEqual(captured.values, [4, 25]);
});
