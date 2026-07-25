import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../src/sync-operations.js', import.meta.url);

async function source() {
  return readFile(sourceUrl, 'utf8');
}

test('registers tenant-scoped readiness dead-letter list and requeue routes', async () => {
  const text = await source();
  assert.match(text, /readiness-delivery-dead-letters/);
  assert.match(text, /:deliveryId\/requeue/);
  assert.match(text, /getReadinessDeliveryDeadLetterStatus/);
  assert.match(text, /requeueReadinessDelivery/);
});

test('resolves authorized workspace before every dead-letter operation', async () => {
  const text = await source();
  const section = text.slice(text.indexOf('function registerReadinessDeadLetterRoutes'));
  assert.match(section, /dependencies\.requireWorkspace\(request\.params\.workspaceId\)/g);
  assert.match(section, /workspaceId: workspace\.id/g);
  assert.doesNotMatch(section, /workspaceId: request\.params\.workspaceId/);
});

test('keeps lists bounded and requeue dry-run by default', async () => {
  const text = await source();
  assert.match(text, /Math\.max\(1, Math\.min\(200, parsed\)\)/);
  assert.match(text, /const apply = request\.body\?\.apply === true/);
  assert.match(text, /reply\.code\(apply \? 200 : 202\)/);
});

test('returns explicit not-found and not-eligible outcomes', async () => {
  const text = await source();
  assert.match(text, /readiness_delivery_not_found/);
  assert.match(text, /readiness_delivery_not_eligible/);
  assert.match(text, /reply\.code\(404\)/);
  assert.match(text, /reply\.code\(409\)/);
});

test('does not serialize recipients, message bodies, credentials, tokens, or session data', async () => {
  const text = await source();
  const serializer = text.slice(text.indexOf('function serializeDeadLetterResult'), text.indexOf('async function withDatabaseTransaction'));
  assert.doesNotMatch(serializer, /recipient|email_body|provider_message_id|access_token|refresh_token|client_secret|session|ip_address/i);
  assert.match(serializer, /incidentId/);
  assert.match(serializer, /snapshotId/);
  assert.match(serializer, /attempts/);
});
