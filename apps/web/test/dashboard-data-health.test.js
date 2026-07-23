import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const componentPath = new URL('../components/sdr/DashboardWorkspaceExperience.tsx', import.meta.url);
const stylesPath = new URL('../components/sdr/dashboard-workspace-experience.css', import.meta.url);

test('dashboard polls tenant-safe workspace operations without exposing internal credentials', async () => {
  const source = await readFile(componentPath, 'utf8');
  assert.match(source, /\/api\/customer\/workspaces\/\$\{encodeURIComponent\(workspaceId\)\}\/operations/);
  assert.match(source, /AbortSignal\.timeout\(15_000\)/);
  assert.match(source, /document\.visibilityState === 'visible'/);
  assert.match(source, /navigator\.onLine/);
  assert.doesNotMatch(source, /ADMIN_API_KEY|x-admin-key|process\.env/);
});

test('dashboard exposes live freshness, active sync and connectivity states', async () => {
  const source = await readFile(componentPath, 'utf8');
  assert.match(source, /LIVE DATA HEALTH/);
  assert.match(source, /activeRun/);
  assert.match(source, /newest_record_sync/);
  assert.match(source, /total_records/);
  assert.match(source, /Updated just now/);
  assert.match(source, /Refresh health/);
  assert.match(source, /addEventListener\('offline'/);
});

test('data health UI has responsive success, warning and critical presentation', async () => {
  const styles = await readFile(stylesPath, 'utf8');
  assert.match(styles, /dashboard-data-health-success|dashboard-data-health \{/);
  assert.match(styles, /dashboard-data-health-warning/);
  assert.match(styles, /dashboard-data-health-critical/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /data-workspace-appearance='dark'/);
});
