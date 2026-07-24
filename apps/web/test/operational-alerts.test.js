import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pagePath = new URL('../app/settings/alerts/page.tsx', import.meta.url);
const proxyPath = new URL('../app/api/customer/workspaces/[workspaceId]/alerts/[[...path]]/route.ts', import.meta.url);
const navPath = new URL('../components/sdr/ObjectRouteNavigationEnhancer.tsx', import.meta.url);

test('operational alert UI supports threshold rules cooldown recovery and test delivery', async () => {
  const page = await readFile(pagePath, 'utf8');
  assert.match(page, /Operational Alerts/);
  assert.match(page, /METRIC_HELP/);
  assert.match(page, /notifyOnRecovery/);
  assert.match(page, /cooldownMinutes/);
  assert.match(page, /Test now/);
  assert.match(page, /Delivery history/);
  assert.match(page, /Provider not configured/);
  assert.doesNotMatch(page, /RESEND_API_KEY|POSTMARK_SERVER_TOKEN|ADMIN_API_KEY|x-admin-key/i);
});

test('alert proxy preserves same-origin workspace authorization and JSON content type', async () => {
  const proxy = await readFile(proxyPath, 'utf8');
  assert.match(proxy, /requireCustomerWorkspace/);
  assert.match(proxy, /ADMIN_ROLES/);
  assert.match(proxy, /customerHeaders\(request, hasBody/);
  assert.match(proxy, /content-type/);
  assert.match(proxy, /AbortSignal\.timeout/);
  assert.match(proxy, /export async function PATCH[\s\S]*forward\(request, context, 'PATCH'\)/);
  assert.match(proxy, /export async function DELETE[\s\S]*forward\(request, context, 'DELETE'\)/);
  assert.match(proxy, /method: 'GET' \| 'POST' \| 'PATCH' \| 'DELETE'/);
});

test('command center navigation exposes alert policy management', async () => {
  const nav = await readFile(navPath, 'utf8');
  assert.match(nav, /\/settings\/alerts/);
  assert.match(nav, /Operational Alerts/);
  assert.match(nav, /Retention Budget/);
  assert.match(nav, /Plans & Usage/);
});

test('billing and retention write proxies preserve JSON content type', async () => {
  const [billing, retention] = await Promise.all([
    readFile(new URL('../app/api/customer/workspaces/[workspaceId]/billing/[action]/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/customer/workspaces/[workspaceId]/retention-budget/[...path]/route.ts', import.meta.url), 'utf8')
  ]);
  assert.match(billing, /customerHeaders\(request, hasBody/);
  assert.match(retention, /customerHeaders\(request, hasBody/);
  assert.match(billing, /application\/json/);
  assert.match(retention, /application\/json/);
});
