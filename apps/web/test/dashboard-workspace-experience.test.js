import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pagePath = new URL('../app/dashboard/page.js', import.meta.url);
const componentPath = new URL('../components/sdr/DashboardWorkspaceExperience.tsx', import.meta.url);
const stylePath = new URL('../components/sdr/dashboard-workspace-experience.css', import.meta.url);
const commandCenterPath = new URL('../components/sdr/RevenueCommandCenter.tsx', import.meta.url);

test('dashboard uses the workspace presentation shell', async () => {
  const source = await readFile(pagePath, 'utf8');
  assert.match(source, /DashboardWorkspaceExperience/);
  assert.doesNotMatch(source, /return <RevenueCommandCenter/);
});

test('workspace presentation is tenant scoped and follows dashboard workspace changes', async () => {
  const source = await readFile(componentPath, 'utf8');
  assert.match(source, /\/api\/customer\/workspaces\/\$\{encodeURIComponent\(workspace\.id\)\}\/preferences/);
  assert.match(source, /fetch\('\/api\/customer\/auth\/session'/);
  assert.match(source, /document\.addEventListener\('change', captureWorkspaceChange, true\)/);
  assert.match(source, /workspaces\.find\(\(item\) => item\.id === target\.value\)/);
  assert.match(source, /ops:last-dashboard-workspace/);
  assert.doesNotMatch(source, /ADMIN_API_KEY|x-admin-key|hubspot.*token/i);
});

test('workspace branding applies safe appearance, locale and accent fallbacks', async () => {
  const source = await readFile(componentPath, 'utf8');
  const styles = await readFile(stylePath, 'utf8');
  assert.match(source, /currency: 'USD'/);
  assert.match(source, /timezone: 'UTC'/);
  assert.match(source, /locale: 'en-US'/);
  assert.match(source, /root\.style\.setProperty\('--workspace-accent'/);
  assert.match(source, /root\.dataset\.workspaceAppearance/);
  assert.match(source, /root\.dir = next\.locale.*startsWith\('ar'\) \? 'rtl' : 'ltr'/s);
  assert.match(styles, /html\[data-workspace-appearance='dark'\]/);
  assert.match(styles, /prefers-color-scheme: dark/);
  assert.match(styles, /var\(--workspace-accent\)/);
});

test('revenue command center exposes modular CRM dashboards and searchable drilldowns', async () => {
  const source = await readFile(commandCenterPath, 'utf8');
  assert.match(source, /Contacts dashboard/);
  assert.match(source, /Companies dashboard/);
  assert.match(source, /Deals & pipeline dashboard/);
  assert.match(source, /Marketing foundation/);
  assert.match(source, /Customer success & retention foundation/);
  assert.match(source, /Dynamic HubSpot property mapping/);
  assert.match(source, /Search loaded records/);
  assert.match(source, /workspaceRole/);
  assert.match(source, /all-companies/);
  assert.match(source, /marketing-contacts/);
});
