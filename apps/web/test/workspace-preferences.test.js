import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const proxyPath = new URL('../app/api/customer/workspaces/[workspaceId]/preferences/route.ts', import.meta.url);
const pagePath = new URL('../app/settings/preferences/page.tsx', import.meta.url);
const navigationPath = new URL('../components/customer/CustomerNavigation.tsx', import.meta.url);

test('preferences proxy verifies customer workspace membership and keeps credentials server-side', async () => {
  const source = await readFile(proxyPath, 'utf8');
  assert.match(source, /requireCustomerWorkspace\(request, workspaceId\)/);
  assert.match(source, /customerHeaders\(request\)/);
  assert.match(source, /cache: 'no-store'/);
  assert.doesNotMatch(source, /ADMIN_API_KEY|x-admin-key/);
});

test('preferences UI covers identity, localization, appearance and read-only roles', async () => {
  const source = await readFile(pagePath, 'utf8');
  assert.match(source, /Branding, currency & localization/);
  assert.match(source, /Company name/);
  assert.match(source, /Logo URL/);
  assert.match(source, /Currency/);
  assert.match(source, /Timezone/);
  assert.match(source, /Locale/);
  assert.match(source, /Accent color/);
  assert.match(source, /Viewer access is read-only/);
  assert.match(source, /Save preferences/);
});

test('customer navigation exposes branding and locale settings', async () => {
  const source = await readFile(navigationPath, 'utf8');
  assert.match(source, /href="\/settings\/preferences"/);
  assert.match(source, /Branding & locale/);
});
