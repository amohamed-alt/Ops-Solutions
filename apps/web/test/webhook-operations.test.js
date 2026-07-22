import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const proxyPath = new URL('../app/api/customer/workspaces/[workspaceId]/operations/route.ts', import.meta.url);
const pagePath = new URL('../app/settings/workspace/page.tsx', import.meta.url);

test('workspace operations proxy forwards tenant-scoped webhook health', async () => {
  const source = await readFile(proxyPath, 'utf8');
  assert.match(source, /requireCustomerWorkspace\(request, workspaceId\)/);
  assert.match(source, /webhookFailures/);
  assert.match(source, /received24h/);
  assert.match(source, /failed24h/);
  assert.match(source, /latestReceivedAt/);
  assert.doesNotMatch(source, /process\.env\.HUBSPOT_CLIENT_SECRET/);
});

test('workspace operations UI renders webhook freshness and failures', async () => {
  const source = await readFile(pagePath, 'utf8');
  assert.match(source, /Webhook delivery/);
  assert.match(source, /Webhook events · 24h/);
  assert.match(source, /Events received · 24h/);
  assert.match(source, /Failures · 24h/);
  assert.match(source, /Deleted records are archived immediately/);
});
