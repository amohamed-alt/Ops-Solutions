import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageUrl = new URL('../app/settings/readiness/page.tsx', import.meta.url);
const proxyUrl = new URL('../app/api/customer/workspaces/[workspaceId]/onboarding-readiness/route.ts', import.meta.url);
const historyProxyUrl = new URL('../app/api/customer/workspaces/[workspaceId]/onboarding-readiness/history/route.ts', import.meta.url);

test('onboarding readiness cancels stale requests and bounds API latency', async () => {
  const source = await readFile(pageUrl, 'utf8');

  assert.match(source, /REQUEST_TIMEOUT_MS\s*=\s*12_000/);
  assert.match(source, /requestRef\.current\?\.abort\(\)/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /window\.setTimeout\(\(\) => controller\.abort\(\), REQUEST_TIMEOUT_MS\)/);
  assert.match(source, /return \(\) => requestRef\.current\?\.abort\(\)/);
});

test('readiness UI uses canonical server evaluation and durable history', async () => {
  const source = await readFile(pageUrl, 'utf8');

  assert.match(source, /onboarding-readiness`/);
  assert.match(source, /onboarding-readiness\/history\?limit=20/);
  assert.match(source, /method: 'POST'/);
  assert.match(source, /Record evaluation/);
  assert.match(source, /Readiness timeline/);
  assert.match(source, /item\.transitioned/);
  assert.doesNotMatch(source, /settle<Billing>|settle<Retention>|serviceUnavailable|stateFor\(/);
});

test('readiness proxies enforce workspace membership and protect admin credentials', async () => {
  const [proxy, historyProxy] = await Promise.all([
    readFile(proxyUrl, 'utf8'),
    readFile(historyProxyUrl, 'utf8')
  ]);

  assert.match(proxy, /requireCustomerWorkspace\(request, workspaceId\)/);
  assert.match(proxy, /\['owner', 'admin'\]\.includes/);
  assert.match(proxy, /internalAdminHeaders/);
  assert.match(proxy, /cache-control': 'no-store, max-age=0/);
  assert.match(historyProxy, /requireCustomerWorkspace\(request, workspaceId\)/);
  assert.match(historyProxy, /encodeURIComponent\(workspaceId\)/);
  assert.doesNotMatch(proxy + historyProxy, /process\.env\.ADMIN_API_KEY|HUBSPOT_CLIENT_SECRET|access_token|refresh_token|DATABASE_URL/);
});

test('readiness UI keeps tenant selection and accessible operational states', async () => {
  const source = await readFile(pageUrl, 'utf8');

  assert.match(source, /localStorage\.setItem\('ops:last-dashboard-workspace', id\)/);
  assert.match(source, /No company workspace is assigned to this account/);
  assert.doesNotMatch(source, /ADMIN_API_KEY|HUBSPOT_CLIENT_SECRET|access_token|refresh_token|DATABASE_URL/);
  assert.match(source, /aria-busy=\{loading\}/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /role="alert"/);
});
