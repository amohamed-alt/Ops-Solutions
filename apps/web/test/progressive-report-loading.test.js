import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const shellPath = new URL('../components/sdr/DashboardProductShell.tsx', import.meta.url);
const routePath = new URL('../app/api/dashboard/[workspaceId]/reports/route.ts', import.meta.url);

test('dashboard requests the core report before advanced operating reports', async () => {
  const shell = await readFile(shellPath, 'utf8');

  assert.match(shell, /searchParams\.set\('scope', 'core'\)/);
  assert.match(shell, /searchParams\.set\('scope', 'operating'\)/);
  assert.match(shell, /response = await originalFetch\(coreUrl\.toString\(\), args\[1\]\)/);
  assert.match(shell, /void originalFetch\(operatingUrl\.toString\(\)/);
  assert.match(shell, /if \(operatingResponse\.ok\) captureOperatingReport/);
  assert.match(shell, /operatingAbort\?\.abort\(\)/);
});

test('advanced report failures cannot block the core dashboard response', async () => {
  const shell = await readFile(shellPath, 'utf8');

  const coreAwait = shell.indexOf('response = await originalFetch(coreUrl.toString(), args[1])');
  const operatingBackground = shell.indexOf('void originalFetch(operatingUrl.toString()');
  assert.ok(coreAwait >= 0);
  assert.ok(operatingBackground > coreAwait);
  assert.match(shell, /\.catch\(\(\) => undefined\)\.finally/);
});

test('report proxy applies separate bounded timeouts per report scope', async () => {
  const route = await readFile(routePath, 'utf8');

  assert.match(route, /CORE_REPORT_TIMEOUT_MS = 60_000/);
  assert.match(route, /OPERATING_REPORT_TIMEOUT_MS = 180_000/);
  assert.match(route, /REPORT_TIMEOUT_MS = 90_000/);
  assert.match(route, /scope === 'core'\) return CORE_REPORT_TIMEOUT_MS/);
  assert.match(route, /scope === 'operating'\) return OPERATING_REPORT_TIMEOUT_MS/);
  assert.match(route, /AbortSignal\.timeout\(reportTimeoutMs/);
  assert.match(route, /revenue_reporting_timeout/);
});
