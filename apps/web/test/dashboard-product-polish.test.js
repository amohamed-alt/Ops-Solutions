import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pagePath = new URL('../app/dashboard/page.js', import.meta.url);
const shellPath = new URL('../components/sdr/DashboardProductShell.tsx', import.meta.url);
const stylePath = new URL('../components/sdr/dashboard-product-polish.css', import.meta.url);

test('dashboard page uses the product enhancement shell', async () => {
  const source = await readFile(pagePath, 'utf8');
  assert.match(source, /DashboardProductShell/);
  assert.match(source, /DashboardWorkspaceExperience/);
});

test('product shell adds record-level HubSpot links for core CRM activities', async () => {
  const source = await readFile(shellPath, 'utf8');
  assert.match(source, /calls: '0-48'/);
  assert.match(source, /meetings: '0-47'/);
  assert.match(source, /tasks: '0-27'/);
  assert.match(source, /contacts: '0-1'/);
  assert.match(source, /deals: '0-3'/);
  assert.match(source, /ric-hubspot-record-link/);
  assert.match(source, /response\.clone\(\)\.json\(\)/);
  assert.match(source, /url\.pathname\.match/);
  assert.match(source, /reports/);
  assert.doesNotMatch(source, /ADMIN_API_KEY|x-admin-key|access[_-]?token|client[_-]?secret/i);
});

test('dashboard charts expose accessible record drill-down actions', async () => {
  const source = await readFile(shellPath, 'utf8');
  const styles = await readFile(stylePath, 'utf8');
  assert.match(source, /'Activity performance': \['Calls', 'Meetings', 'Overdue tasks'\]/);
  assert.match(source, /'Pipeline by stage': \['Open deals', 'Deals at risk'\]/);
  assert.match(source, /chart\.setAttribute\('role', 'button'\)/);
  assert.match(source, /event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.match(styles, /ric-chart-drill-button/);
  assert.match(styles, /ric-chart-interactive/);
  assert.match(styles, /prefers-reduced-motion/);
});
