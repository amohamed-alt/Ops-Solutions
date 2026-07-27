import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pagePath = new URL('../app/settings/billing/page.js', import.meta.url);
const clientPath = new URL('../components/sdr/BillingLifecycleClient.tsx', import.meta.url);

test('billing page exposes the billing lifecycle client', async () => {
  const page = await readFile(pagePath, 'utf8');
  assert.match(page, /BillingLifecycleClient/);
  assert.match(page, /force-dynamic/);
});

test('billing lifecycle page documents plans and guarded lifecycle actions', async () => {
  const client = await readFile(clientPath, 'utf8');
  for (const plan of ['Intelligence', 'Builder', 'Automation', 'Enterprise']) {
    assert.match(client, new RegExp(plan));
  }
  assert.match(client, /Payment provider not connected yet/);
  assert.match(client, /HubSpot uninstall handling/);
  assert.match(client, /Data deletion request/);
  assert.match(client, /signed billing webhooks/);
  assert.match(client, /owner\/admin-only/);
});
