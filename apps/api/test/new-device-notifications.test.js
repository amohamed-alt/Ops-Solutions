import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  buildNewDeviceNotificationMessage,
  ensureNewDeviceNotificationSchema
} from '../src/new-device-notifications.js';

test('builds a privacy-safe new-device message with escaped customer content', () => {
  const message = buildNewDeviceNotificationMessage({
    display_name: '<script>alert(1)</script>',
    user_agent: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
    session_created_at: '2026-07-24T10:00:00Z',
    ip_hash: 'must-not-appear',
    session_token_hash: 'must-not-appear'
  }, 'https://ops.dashboardtalentera.tech');

  assert.equal(message.subject, 'New sign-in to your Ops Solutions account');
  assert.match(message.text, /Google Chrome/);
  assert.match(message.text, /Windows computer/);
  assert.match(message.text, /settings\/security/);
  assert.match(message.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(message.html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(JSON.stringify(message), /must-not-appear/);
});

test('schema bootstrap is idempotent and replica safe', async () => {
  const queries = [];
  const client = {
    async query(text) { queries.push(String(text)); return { rowCount: 0, rows: [] }; },
    release() {}
  };
  await ensureNewDeviceNotificationSchema({ async connect() { return client; } });
  const sql = queries.join('\n');
  assert.match(sql, /pg_advisory_lock/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS account_security_notifications/);
  assert.match(sql, /UNIQUE \(user_id, session_token_hash, notification_type\)/);
  assert.match(sql, /account_security_notifications_due_idx/);
  assert.match(sql, /pg_advisory_unlock/);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM/);
});

test('candidate discovery is account scoped, idempotent and skips first-ever sessions', async () => {
  const source = await readFile(new URL('../src/new-device-notifications.js', import.meta.url), 'utf8');
  assert.match(source, /any_prior\.user_id = s\.user_id/);
  assert.match(source, /familiar\.user_id = s\.user_id/);
  assert.match(source, /familiar\.user_agent IS NOT DISTINCT FROM s\.user_agent/);
  assert.match(source, /familiar\.ip_hash IS NOT DISTINCT FROM s\.ip_hash/);
  assert.match(source, /ON CONFLICT \(user_id, session_token_hash, notification_type\) DO NOTHING/);
  assert.match(source, /FOR UPDATE OF n SKIP LOCKED/);
  assert.match(source, /idempotencyKey: `new-device-/);
});

test('notification payloads never include raw IPs or session credentials', async () => {
  const source = await readFile(new URL('../src/new-device-notifications.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /SELECT[^;]*request\.ip/is);
  assert.doesNotMatch(source, /recipients:\s*\[[^\]]*token/i);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^)]*(?:token_hash|ip_hash|email)/i);
  assert.match(source, /notificationId: row\.id/);
  assert.doesNotMatch(source, /metadata[^\n]*(?:user_agent|ip_hash|session_token_hash)/i);
});
