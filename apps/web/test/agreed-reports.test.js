import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const shellPath = new URL('../components/sdr/DashboardProductShell.tsx', import.meta.url);
const panelPath = new URL('../components/sdr/AgreedReportsPanel.tsx', import.meta.url);
const stylePath = new URL('../components/sdr/agreed-reports.css', import.meta.url);

test('dashboard captures the adaptive report payload and renders the agreed panel', async () => {
  const shell = await readFile(shellPath, 'utf8');
  assert.match(shell, /AgreedReportsPanel/);
  assert.match(shell, /payload\?\.report\?\.operatingReports/);
  assert.match(shell, /\/api\/dashboard\/\(\[\^\/\]\+\)\/reports\$/);
  assert.match(shell, /workspaceContexts\[reportSnapshot\.workspaceId\]/);
});

test('agreed reports expose the operational definitions and HubSpot drilldowns', async () => {
  const panel = await readFile(panelPath, 'utf8');
  assert.match(panel, /TODAY'S FOCUS/);
  assert.match(panel, /YESTERDAY'S PERFORMANCE/);
  assert.match(panel, /OUTREACH & CONVERSION/);
  assert.match(panel, /RANK \/ TIER FUNNEL/);
  assert.match(panel, /RETENTION & RENEWALS/);
  assert.match(panel, /connected-calls/);
  assert.match(panel, /completed-meetings/);
  assert.match(panel, /no-show-meetings/);
  assert.match(panel, /priority-needs-contact/);
  assert.match(panel, /retention-delayed/);
  assert.match(panel, /Open in HubSpot/);
  assert.doesNotMatch(panel, /ADMIN_API_KEY|x-admin-key|access[_-]?token|client[_-]?secret/i);
});

test('role modes show only their relevant agreed report sections', async () => {
  const styles = await readFile(stylePath, 'utf8');
  assert.match(styles, /data-command-role='executive'/);
  assert.match(styles, /data-command-role='manager'/);
  assert.match(styles, /data-command-role='sdr'/);
  assert.match(styles, /data-command-role='revops'/);
  assert.match(styles, /arr-role-executive/);
  assert.match(styles, /arr-role-manager/);
  assert.match(styles, /arr-role-sdr/);
  assert.match(styles, /arr-role-revops/);
  assert.match(styles, /prefers-reduced-motion/);
});
