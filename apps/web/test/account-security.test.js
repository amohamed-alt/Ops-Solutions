import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const proxyPath = new URL('../app/api/customer/security/route.ts', import.meta.url);
const pagePath = new URL('../app/settings/security/page.tsx', import.meta.url);
const navigationPath = new URL('../components/customer/CustomerNavigation.tsx', import.meta.url);

test('account security proxy requires a customer session and keeps credentials server side', async () => {
  const source = await readFile(proxyPath, 'utf8');
  assert.match(source, /getCustomerContext\(request\)/);
  assert.match(source, /customerHeaders\(request\)/);
  assert.match(source, /api\/v1\/customer\/security/);
  assert.match(source, /trust-current/);
  assert.match(source, /rename_device/);
  assert.match(source, /revoke_device/);
  assert.match(source, /export async function PATCH/);
  assert.match(source, /cache-control.*no-store/si);
  assert.doesNotMatch(source, /ADMIN_API_KEY|process\.env\./);
});

test('account security UI manages trusted devices and active sessions', async () => {
  const source = await readFile(pagePath, 'utf8');
  assert.match(source, /Sessions, devices and recovery activity/);
  assert.match(source, /Trusted devices/);
  assert.match(source, /Trust this device/);
  assert.match(source, /trust_current_device/);
  assert.match(source, /rename_device/);
  assert.match(source, /revoke_device/);
  assert.match(source, /Remove trust/);
  assert.match(source, /Existing sessions remain active but are reclassified immediately/);
  assert.match(source, /device\.renamed/);
  assert.match(source, /device\.revoked/);
  assert.match(source, /Revoke all other sessions/);
  assert.match(source, /Current session/);
  assert.match(source, /Reset password securely/);
  assert.match(source, /Loading account security/);
});

test('customer navigation exposes account security', async () => {
  const source = await readFile(navigationPath, 'utf8');
  assert.match(source, /href="\/settings\/security"/);
  assert.match(source, /Account security/);
});
