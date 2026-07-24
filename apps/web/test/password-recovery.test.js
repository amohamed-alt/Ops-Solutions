import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const forgotPage = new URL('../app/forgot-password/page.tsx', import.meta.url);
const resetPage = new URL('../app/reset-password/page.tsx', import.meta.url);
const forgotProxy = new URL('../app/api/customer/auth/password/forgot/route.ts', import.meta.url);
const resetProxy = new URL('../app/api/customer/auth/password/reset/route.ts', import.meta.url);

test('forgot password screen preserves account enumeration protection', async () => {
  const source = await readFile(forgotPage, 'utf8');
  assert.match(source, /response is the same whether or not an account exists/);
  assert.match(source, /\/api\/customer\/auth\/password\/forgot/);
  assert.match(source, /autoComplete="email"/);
});

test('reset screen validates confirmation and explains global session revocation', async () => {
  const source = await readFile(resetPage, 'utf8');
  assert.match(source, /password !== confirmPassword/);
  assert.match(source, /signs your account out on every device/);
  assert.match(source, /\/api\/customer\/auth\/password\/reset/);
  assert.match(source, /autoComplete="new-password"/);
});

test('password recovery proxies remain no-store and keep credentials server-side', async () => {
  const forgot = await readFile(forgotProxy, 'utf8');
  const reset = await readFile(resetProxy, 'utf8');
  for (const source of [forgot, reset]) {
    assert.match(source, /API_URL/);
    assert.match(source, /cache: 'no-store'/);
    assert.match(source, /cache-control': 'no-store, max-age=0/);
    assert.doesNotMatch(source, /ADMIN_API_KEY|RESEND_API_KEY|POSTMARK_SERVER_TOKEN/);
  }
  assert.match(reset, /clearCustomerSession/);
});
