import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const proxyPath = new URL('../app/api/customer/workspaces/[workspaceId]/mapping-wizard/route.ts', import.meta.url);
const pagePath = new URL('../app/settings/mappings/page.tsx', import.meta.url);
const navigationPath = new URL('../components/customer/CustomerNavigation.tsx', import.meta.url);

test('mapping wizard proxy keeps customer authorization server-side', async () => {
  const source = await readFile(proxyPath, 'utf8');
  assert.match(source, /requireCustomerWorkspace\(request, workspaceId\)/);
  assert.match(source, /customerHeaders\(request\)/);
  assert.match(source, /mapping-wizard/);
  assert.match(source, /method: 'PUT'/);
  assert.match(source, /method: 'DELETE'/);
  assert.match(source, /action !== 'rollback'/);
  assert.doesNotMatch(source, /internalAdminHeaders/);
  assert.doesNotMatch(source, /process\.env\.ADMIN_API_KEY/);
});

test('mapping wizard UI supports evidence review, normalization, history and role guards', async () => {
  const source = await readFile(pagePath, 'utf8');
  assert.match(source, /No low-confidence property is approved automatically/);
  assert.match(source, /Sample values/);
  assert.match(source, /Normalize values/);
  assert.match(source, /Version history/);
  assert.match(source, /Save mapping/);
  assert.match(source, /Remove mapping/);
  assert.match(source, /Viewer access is read-only/);
  assert.match(source, /Restored/);
});

test('customer navigation exposes the mapping workspace', async () => {
  const source = await readFile(navigationPath, 'utf8');
  assert.match(source, /href="\/settings\/mappings"/);
  assert.match(source, /Mappings/);
});
