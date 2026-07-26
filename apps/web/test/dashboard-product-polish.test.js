import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pagePath = new URL('../app/dashboard/page.js', import.meta.url);
const componentPath = new URL('../components/sdr/CommandCenterV2.tsx', import.meta.url);
const stylePath = new URL('../components/sdr/command-center-v2.css', import.meta.url);

test('dashboard page uses the focused command center component', async () => {
  const source = await readFile(pagePath, 'utf8');
  assert.match(source, /CommandCenterV2/);
  assert.match(source, /PdfSnapshotAction/);
  assert.doesNotMatch(source, /DashboardProductShell|DashboardWorkspaceExperience/);
});

test('rebuilt command center keeps record-level HubSpot links and drilldowns', async () => {
  const source = await readFile(componentPath, 'utf8');
  assert.match(source, /calls: '0-48'/);
  assert.match(source, /meetings: '0-47'/);
  assert.match(source, /tasks: '0-27'/);
  assert.match(source, /contacts: '0-1'/);
  assert.match(source, /deals: '0-3'/);
  assert.match(source, /Open in HubSpot/);
  assert.match(source, /reports\/\$\{encodeURIComponent\(key\)\}/);
  assert.match(source, /loadDrilldown/);
  assert.doesNotMatch(source, /ADMIN_API_KEY|x-admin-key|access[_-]?token|client[_-]?secret/i);
});

test('dashboard charts and KPI cards remain accessible interactive controls', async () => {
  const source = await readFile(componentPath, 'utf8');
  const styles = await readFile(stylePath, 'utf8');
  assert.match(source, /button className=\{`cc2-kpi/);
  assert.match(source, /aria-label="Command center navigation"/);
  assert.match(source, /aria-label="Dashboard role"/);
  assert.match(source, /aria-label="Close report"/);
  assert.match(source, /DECISION INTELLIGENCE/);
  assert.match(source, /scope: 'operating'/);
  assert.match(source, /Lead quality funnel/);
  assert.match(source, /Commercial milestones/i);
  assert.match(source, /filterOverrides/);
  assert.match(styles, /button\.cc2-kpi\s*\{\s*cursor:\s*pointer/);
  assert.match(styles, /\.cc2-decision/);
  assert.match(styles, /\.cc2-pipeline-health/);
  assert.match(styles, /\.cc2-execution/);
  assert.match(styles, /\.cc2-kpi:hover/);
  assert.match(styles, /\.cc2-drawer-backdrop/);
});
