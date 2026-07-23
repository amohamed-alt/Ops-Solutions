import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pagePath = new URL('../app/settings/fleet/page.tsx', import.meta.url);
const navigationPath = new URL('../components/customer/CustomerNavigation.tsx', import.meta.url);
const operationsProxyPath = new URL('../app/api/customer/workspaces/[workspaceId]/operations/route.ts', import.meta.url);

test('fleet console reads only session-authorized workspace operations', async () => {
  const source = await readFile(pagePath, 'utf8');
  assert.match(source, /fetch\('\/api\/customer\/auth\/session'/);
  assert.match(source, /workspaceList\.map\(readOperations\)/);
  assert.match(source, /\/api\/customer\/workspaces\/\$\{encodeURIComponent\(workspace\.id\)\}\/operations/);
  assert.doesNotMatch(source, /ADMIN_API_KEY|internalAdminHeaders|x-admin-key/);
});

test('fleet console provides health, webhook, mapping and CRM visibility', async () => {
  const source = await readFile(pagePath, 'utf8');
  assert.match(source, /Revenue operations fleet health/);
  assert.match(source, /Webhook failures · 24h/);
  assert.match(source, /Approved mappings/);
  assert.match(source, /CRM records mirrored/);
  assert.match(source, /Needs attention only/);
  assert.match(source, /Unavailable workspaces/);
});

test('fleet actions remain role guarded and use the existing tenant-safe proxy', async () => {
  const [page, proxy] = await Promise.all([
    readFile(pagePath, 'utf8'),
    readFile(operationsProxyPath, 'utf8')
  ]);
  assert.match(page, /roleRank\[row\.workspace\.role\] < roleRank\.admin/);
  assert.match(page, /Boolean\(row\.sync\.activeRun\)/);
  assert.match(page, /JSON\.stringify\(\{ action: 'sync', mode \}\)/);
  assert.match(proxy, /requireCustomerWorkspace\(request, workspaceId\)/);
  assert.match(proxy, /ADMIN_ROLES = new Set\(\['owner', 'admin'\]\)/);
});

test('customer navigation exposes fleet health separately from one-workspace operations', async () => {
  const source = await readFile(navigationPath, 'utf8');
  assert.match(source, /href="\/settings\/fleet"/);
  assert.match(source, /Fleet health/);
  assert.match(source, /href="\/settings\/workspace"/);
});
