import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const proxyPath = new URL('../app/api/customer/workspaces/[workspaceId]/operations/route.ts', import.meta.url);
const pagePath = new URL('../app/settings/workspace/page.tsx', import.meta.url);
const navigationPath = new URL('../components/customer/CustomerNavigation.tsx', import.meta.url);

test('workspace operations proxy verifies membership before internal admin requests', async () => {
  const source = await readFile(proxyPath, 'utf8');
  assert.match(source, /requireCustomerWorkspace\(request, workspaceId\)/);
  assert.match(source, /ADMIN_ROLES = new Set\(\['owner', 'admin'\]\)/);
  assert.match(source, /internalAdminHeaders\(\)/);
  assert.match(source, /workspace_role_required/);
  assert.match(source, /SYNC_MODES = new Set\(\['incremental', 'full'\]\)/);
  assert.doesNotMatch(source, /process\.env\.ADMIN_API_KEY/);
});

test('workspace operations UI exposes monitoring and guarded recovery controls', async () => {
  const source = await readFile(pagePath, 'utf8');
  assert.match(source, /HubSpot connection & data health/);
  assert.match(source, /Incremental sync/);
  assert.match(source, /Full reconciliation/);
  assert.match(source, /Rediscover CRM/);
  assert.match(source, /Viewer access can monitor health/);
  assert.match(source, /recordCounts\.map/);
});

test('customer navigation links to workspace operations and team security separately', async () => {
  const source = await readFile(navigationPath, 'utf8');
  assert.match(source, /href="\/settings\/workspace"/);
  assert.match(source, /href="\/settings\/team"/);
});
