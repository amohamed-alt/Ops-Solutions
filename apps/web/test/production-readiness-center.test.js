import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageUrl = new URL('../app/settings/readiness/page.tsx', import.meta.url);
const navUrl = new URL('../components/sdr/ObjectRouteNavigationEnhancer.tsx', import.meta.url);

test('production readiness center renders canonical tenant readiness without secrets', async () => {
  const page = await readFile(pageUrl, 'utf8');
  assert.match(page, /Onboarding Readiness/);
  assert.match(page, /onboarding-readiness/);
  assert.match(page, /PRODUCTION GATE/);
  assert.match(page, /HubSpot connection/);
  assert.match(page, /Readiness timeline/);
  assert.match(page, /Record evaluation/);
  assert.doesNotMatch(page, /ADMIN_API_KEY|x-admin-key|RESEND_API_KEY|POSTMARK_SERVER_TOKEN|STRIPE_SECRET|DATABASE_URL/i);
});

test('dashboard navigation links operators to launch readiness', async () => {
  const nav = await readFile(navUrl, 'utf8');
  assert.match(nav, /\/settings\/readiness/);
  assert.match(nav, /Production Readiness/);
});
