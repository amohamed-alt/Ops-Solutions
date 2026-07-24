import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageUrl = new URL('../app/settings/readiness/page.tsx', import.meta.url);
const navUrl = new URL('../components/sdr/ObjectRouteNavigationEnhancer.tsx', import.meta.url);

test('production readiness center aggregates current tenant services without secrets', async () => {
  const page = await readFile(pageUrl, 'utf8');
  assert.match(page, /Production Readiness/);
  assert.match(page, /\/billing/);
  assert.match(page, /retention-budget\/report/);
  assert.match(page, /report-schedules/);
  assert.match(page, /\/alerts/);
  assert.match(page, /reports\?scope=core/);
  assert.match(page, /HubSpot Marketplace approval/);
  assert.match(page, /Email delivery provider/);
  assert.match(page, /Live payment collection/);
  assert.doesNotMatch(page, /ADMIN_API_KEY|x-admin-key|RESEND_API_KEY|POSTMARK_SERVER_TOKEN|STRIPE_SECRET|DATABASE_URL/i);
});

test('dashboard navigation links operators to launch readiness', async () => {
  const nav = await readFile(navUrl, 'utf8');
  assert.match(nav, /\/settings\/readiness/);
  assert.match(nav, /Production Readiness/);
});
