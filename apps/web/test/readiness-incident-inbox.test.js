import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageUrl = new URL('../app/settings/readiness/page.tsx', import.meta.url);
const listProxyUrl = new URL('../app/api/customer/workspaces/[workspaceId]/readiness-incidents/route.ts', import.meta.url);
const actionProxyUrl = new URL('../app/api/customer/workspaces/[workspaceId]/readiness-incidents/[incidentId]/[action]/route.ts', import.meta.url);

async function source(url) {
  return readFile(url, 'utf8');
}

test('readiness center renders a tenant incident inbox with lifecycle actions', async () => {
  const page = await source(pageUrl);
  assert.match(page, /Readiness incidents/);
  assert.match(page, /OPERATIONS INBOX/);
  assert.match(page, /Acknowledge/);
  assert.match(page, /Resolve/);
  assert.match(page, /readiness-incidents/);
  assert.match(page, /workspace\?\.role\s*===\s*'owner'\s*\|\|\s*workspace\?\.role\s*===\s*'admin'/);
});

test('incident list proxy validates workspace access and bounds responses', async () => {
  const proxy = await source(listProxyUrl);
  assert.match(proxy, /requireCustomerWorkspace\(request, workspaceId\)/);
  assert.match(proxy, /Math\.max\(1, Math\.min\(200, requestedLimit\)\)/);
  assert.match(proxy, /cache: 'no-store'/);
  assert.match(proxy, /AbortSignal\.timeout\(20_000\)/);
});

test('incident lifecycle proxy enforces RBAC and allowlisted actions', async () => {
  const proxy = await source(actionProxyUrl);
  assert.match(proxy, /ALLOWED_ACTIONS = new Set\(\['acknowledge', 'resolve'\]\)/);
  assert.match(proxy, /\['owner', 'admin'\]\.includes/);
  assert.match(proxy, /encodeURIComponent\(incidentId\)/);
  assert.match(proxy, /slice\(0, 1000\)/);
  assert.doesNotMatch(proxy, /ADMIN_API_KEY|RESEND_API_KEY|POSTMARK_SERVER_TOKEN|DATABASE_URL/i);
});

test('incident UI excludes private delivery and authentication fields', async () => {
  const page = await source(pageUrl);
  assert.doesNotMatch(page, /recipient|emailBody|providerMessageId|accessToken|refreshToken|sessionToken|ipAddress/i);
});
