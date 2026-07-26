import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pagePath = new URL('../app/settings/readiness/page.tsx', import.meta.url);

async function source() {
  return readFile(pagePath, 'utf8');
}

test('readiness response health uses bounded operational SLA thresholds', async () => {
  const text = await source();
  assert.match(text, /ACKNOWLEDGEMENT_SLA_MS=4\*60\*60\*1000/);
  assert.match(text, /RESOLUTION_SLA_MS=24\*60\*60\*1000/);
  assert.match(text, /status==='open'.*ACKNOWLEDGEMENT_SLA_MS/);
  assert.match(text, /status!=='resolved'/);
});

test('response health separates active, overdue, critical and notification coverage signals', async () => {
  const text = await source();
  assert.match(text, /notificationGaps=active\.filter\(item=>!item\.lastNotifiedAt\)/);
  assert.match(text, /critical=active\.filter\(item=>item\.severity==='critical'\)/);
  assert.match(text, /Incident response SLA/);
  assert.match(text, /currently loaded tenant-scoped incident page/);
  assert.match(text, /NOTIFICATION COVERAGE/);
});

test('response health does not claim fleet-wide completeness', async () => {
  const text = await source();
  assert.doesNotMatch(text, /fleet-wide incident response/i);
  assert.match(text, /loaded result set/);
});
