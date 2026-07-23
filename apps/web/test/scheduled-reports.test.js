import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pagePath = new URL('../app/settings/reports/page.tsx', import.meta.url);
const routePath = new URL('../app/api/customer/workspaces/[workspaceId]/report-schedules/route.ts', import.meta.url);
const itemRoutePath = new URL('../app/api/customer/workspaces/[workspaceId]/report-schedules/[scheduleId]/route.ts', import.meta.url);
const navigationPath = new URL('../components/customer/CustomerNavigation.tsx', import.meta.url);

test('scheduled report proxies enforce customer membership and admin writes', async () => {
  const [route, itemRoute] = await Promise.all([readFile(routePath, 'utf8'), readFile(itemRoutePath, 'utf8')]);
  assert.match(route, /requireCustomerWorkspace\(request, workspaceId\)/);
  assert.match(route, /ADMIN_ROLES/);
  assert.match(route, /workspace_role_required/);
  assert.match(route, /customerHeaders\(request\)/);
  assert.doesNotMatch(route, /process\.env\.ADMIN_API_KEY/);
  assert.match(itemRoute, /method: 'PATCH' \| 'DELETE'/);
  assert.match(itemRoute, /requireCustomerWorkspace\(request, workspaceId\)/);
});

test('scheduled reports UI covers saved views, timezone, recipients and lifecycle controls', async () => {
  const source = await readFile(pagePath, 'utf8');
  assert.match(source, /Deliver revenue intelligence on time/);
  assert.match(source, /saved-views/);
  assert.match(source, /Africa\/Cairo/);
  assert.match(source, /Recipients/);
  assert.match(source, /Create schedule/);
  assert.match(source, /toggle\(schedule\)/);
  assert.match(source, /Delivery provider pending/);
  assert.match(source, /Viewer access can monitor schedules/);
});

test('customer navigation exposes scheduled reports', async () => {
  const source = await readFile(navigationPath, 'utf8');
  assert.match(source, /href="\/settings\/reports"/);
  assert.match(source, /Scheduled reports/);
});
