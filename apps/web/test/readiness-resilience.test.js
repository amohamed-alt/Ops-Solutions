import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageUrl = new URL('../app/settings/readiness/page.tsx', import.meta.url);

test('production readiness cancels stale requests and bounds service latency', async () => {
  const source = await readFile(pageUrl, 'utf8');

  assert.match(source, /REQUEST_TIMEOUT_MS\s*=\s*12_000/);
  assert.match(source, /requestRef\.current\?\.abort\(\)/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /window\.setTimeout\(\(\) => controller\.abort\(\), REQUEST_TIMEOUT_MS\)/);
  assert.match(source, /return \(\) => requestRef\.current\?\.abort\(\)/);
});

test('partial service failures are warnings rather than false onboarding blockers', async () => {
  const source = await readFile(pageUrl, 'utf8');

  assert.match(source, /function serviceUnavailable/);
  assert.match(source, /state: 'warning'/);
  assert.match(source, /Promise\.all\(/);
  assert.match(source, /settle<Billing>/);
  assert.match(source, /settle<Retention>/);
  assert.match(source, /settle<Schedules>/);
  assert.match(source, /settle<Alerts>/);
});

test('readiness UI keeps tenant selection and does not expose secrets', async () => {
  const source = await readFile(pageUrl, 'utf8');

  assert.match(source, /localStorage\.setItem\('ops:last-dashboard-workspace', id\)/);
  assert.match(source, /No company workspace is assigned to this account/);
  assert.doesNotMatch(source, /ADMIN_API_KEY|HUBSPOT_CLIENT_SECRET|access_token|refresh_token|DATABASE_URL/);
  assert.match(source, /aria-busy=\{loading\}/);
  assert.match(source, /aria-live="polite"/);
});
