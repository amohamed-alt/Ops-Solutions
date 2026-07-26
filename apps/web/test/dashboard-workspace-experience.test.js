import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pagePath = new URL('../app/dashboard/page.js', import.meta.url);
const componentPath = new URL('../components/sdr/CommandCenterV2.tsx', import.meta.url);
const stylePath = new URL('../components/sdr/command-center-v2.css', import.meta.url);

test('dashboard uses one unified workspace experience', async () => {
  const page = await readFile(pagePath, 'utf8');
  assert.match(page, /CommandCenterV2/);
  assert.doesNotMatch(page, /DashboardWorkspaceExperience|DashboardProductShell/);
});

test('workspace selection remains tenant scoped and persistent', async () => {
  const source = await readFile(componentPath, 'utf8');
  assert.match(source, /json<\{ results\?: WorkspaceState\[\] \}>\('\/api\/customer\/workspaces'\)/);
  assert.match(source, /row\.workspace\.hubspot_status === 'connected'/);
  assert.match(source, /ops:last-dashboard-workspace/);
  assert.match(source, /changeWorkspace/);
  assert.match(source, /\/api\/dashboard\/\$\{encodeURIComponent\(workspaceId\)\}\/reports/);
  assert.doesNotMatch(source, /ADMIN_API_KEY|x-admin-key|hubspot.*token/i);
});

test('role-specific command centers are persistent and visible in the real header', async () => {
  const source = await readFile(componentPath, 'utf8');
  const styles = await readFile(stylePath, 'utf8');
  assert.match(source, /type CommandRole = 'executive' \| 'manager' \| 'sdr' \| 'revops'/);
  assert.match(source, /ops:dashboard-command-role/);
  assert.match(source, /data-command-role=\{commandRole\}/);
  assert.match(source, /Executive Command Center/);
  assert.match(source, /Sales Manager Workspace/);
  assert.match(source, /SDR Workspace/);
  assert.match(source, /Revenue Operations/);
  assert.match(styles, /\.cc2-role-switch/);
  assert.match(styles, /\.cc2-role-switch button\.active/);
});

test('workspace UI uses the light green design system and responsive layout', async () => {
  const styles = await readFile(stylePath, 'utf8');
  assert.match(styles, /--cc2-bg:\s*#f2f6f4/);
  assert.match(styles, /--cc2-sidebar:\s*#0d4c3e/);
  assert.match(styles, /--cc2-green:\s*#087a50/);
  assert.match(styles, /@media \(max-width: 1000px\)/);
  assert.match(styles, /@media \(max-width: 720px\)/);
});
