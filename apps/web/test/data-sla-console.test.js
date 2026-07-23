import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pagePath = new URL('../app/settings/data-sla/page.tsx', import.meta.url);
const navigationPath = new URL('../components/customer/CustomerNavigation.tsx', import.meta.url);

test('data SLA console uses tenant-safe customer operations routes only', async () => {
  const source = await readFile(pagePath, 'utf8');
  assert.match(source, /\/api\/customer\/auth\/session/);
  assert.match(source, /\/api\/customer\/workspaces\/\$\{encodeURIComponent\(workspace\.id\)\}\/operations/);
  assert.doesNotMatch(source, /ADMIN_API_KEY|x-admin-key|hubspot.*token/i);
  assert.match(source, /AbortSignal\.timeout\(15_000\)/);
});

test('data SLA console evaluates freshness, webhooks, mappings and connection health', async () => {
  const source = await readFile(pagePath, 'utf8');
  assert.match(source, /WARNING_MINUTES = 90/);
  assert.match(source, /CRITICAL_MINUTES = 24 \* 60/);
  assert.match(source, /failed24h/);
  assert.match(source, /pendingSuggestions/);
  assert.match(source, /HubSpot disconnected/);
  assert.match(source, /Latest synchronization failed/);
  assert.match(source, /visibilityState === 'visible'/);
  assert.match(source, /navigator\.onLine/);
});

test('data SLA snapshot excludes CRM payloads and credentials', async () => {
  const source = await readFile(pagePath, 'utf8');
  assert.match(source, /generatedAt/);
  assert.match(source, /failedWebhooks24h/);
  assert.doesNotMatch(source, /\.properties|raw_payload|access_token|refresh_token/);
});

test('customer navigation exposes the data SLA console', async () => {
  const source = await readFile(navigationPath, 'utf8');
  assert.match(source, /href="\/settings\/data-sla"/);
  assert.match(source, /Data SLAs/);
});
