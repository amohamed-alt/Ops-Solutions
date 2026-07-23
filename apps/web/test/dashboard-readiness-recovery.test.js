import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const onboardingStatusPath = new URL('../app/api/customer/onboarding/status/route.ts', import.meta.url);
const reportPath = new URL('../app/api/dashboard/[workspaceId]/reports/route.ts', import.meta.url);
const drilldownPath = new URL('../app/api/dashboard/[workspaceId]/reports/[reportKey]/route.ts', import.meta.url);

test('onboarding becomes ready from usable synchronized data even when the latest run is stale', async () => {
  const source = await readFile(onboardingStatusPath, 'utf8');

  assert.match(source, /successfulCursors/);
  assert.match(source, /newest_record_sync/);
  assert.match(source, /const synchronized = totalRecords > 0/);
  assert.match(source, /const ready = connected && discovered && synchronized/);
  assert.match(source, /staleActiveRun/);
  assert.doesNotMatch(source, /const ready = connected && discovered && completed;/);
});

test('large revenue reports and drilldowns have bounded extended timeouts', async () => {
  const report = await readFile(reportPath, 'utf8');
  const drilldown = await readFile(drilldownPath, 'utf8');

  assert.match(report, /REPORT_TIMEOUT_MS = 90_000/);
  assert.match(report, /revenue_reporting_timeout/);
  assert.match(drilldown, /DRILLDOWN_TIMEOUT_MS = 60_000/);
  assert.match(drilldown, /revenue_drilldown_timeout/);
  assert.doesNotMatch(`${report}\n${drilldown}`, /ADMIN_API_KEY|x-admin-key|access[_-]?token|client[_-]?secret/i);
});
