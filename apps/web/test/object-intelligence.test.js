import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pagePath = new URL('../app/dashboard/page.js', import.meta.url);
const commandCenterPath = new URL('../components/sdr/CommandCenterV2.tsx', import.meta.url);
const componentPath = new URL('../components/sdr/ObjectIntelligenceWorkspace.tsx', import.meta.url);
const objectStylesPath = new URL('../components/sdr/object-intelligence.css', import.meta.url);
const overviewRoutePath = new URL('../app/api/dashboard/[workspaceId]/objects/route.ts', import.meta.url);
const detailRoutePath = new URL('../app/api/dashboard/[workspaceId]/objects/[objectType]/route.ts', import.meta.url);
const drilldownRoutePath = new URL('../app/api/dashboard/[workspaceId]/objects/[objectType]/drilldowns/[reportKey]/route.ts', import.meta.url);

test('main dashboard links to object intelligence instead of mounting a duplicate workspace', async () => {
  const page = await readFile(pagePath, 'utf8');
  const commandCenter = await readFile(commandCenterPath, 'utf8');
  assert.doesNotMatch(page, /ObjectIntelligenceWorkspace/);
  assert.match(commandCenter, /\/dashboard\/all-objects/);
  assert.match(commandCenter, /\/dashboard\/objects\/contacts/);
  assert.match(commandCenter, /\/dashboard\/objects\/companies/);
  assert.match(commandCenter, /\/dashboard\/objects\/deals/);
});

test('object intelligence covers all primary HubSpot objects with lazy detail reports', async () => {
  const component = await readFile(componentPath, 'utf8');
  for (const objectType of ['contacts', 'companies', 'deals', 'calls', 'meetings', 'tasks', 'tickets']) {
    assert.match(component, new RegExp(`${objectType}:`));
  }
  assert.match(component, /\/objects\?\$\{queryString/);
  assert.match(component, /objects\/\$\{encodeURIComponent\(objectType\)\}/);
  assert.match(component, /drilldowns\/\$\{encodeURIComponent\(metric\.key\)\}/);
  assert.match(component, /Open in HubSpot/);
  assert.match(component, /createPortal/);
  assert.match(component, /oi-nav-button/);
  assert.doesNotMatch(component, /ADMIN_API_KEY|x-admin-key|access[_-]?token|client[_-]?secret/i);
});

test('object intelligence uses responsive cards, charts, skeletons and a record drawer', async () => {
  const styles = await readFile(objectStylesPath, 'utf8');
  assert.match(styles, /\.oi-object-grid/);
  assert.match(styles, /\.oi-metric-grid/);
  assert.match(styles, /\.oi-detail-skeleton/);
  assert.match(styles, /\.oi-drawer-backdrop/);
  assert.match(styles, /@media \(max-width: 620px\)/);
  assert.match(styles, /prefers-reduced-motion/);
});

test('object report proxy routes preserve customer authorization and bounded timeouts', async () => {
  const overview = await readFile(overviewRoutePath, 'utf8');
  const detail = await readFile(detailRoutePath, 'utf8');
  const drilldown = await readFile(drilldownRoutePath, 'utf8');
  const combined = `${overview}\n${detail}\n${drilldown}`;
  assert.match(overview, /analytics\/objects/);
  assert.match(detail, /analytics\/objects\/\$\{encodeURIComponent\(objectType\)\}/);
  assert.match(drilldown, /drilldowns\/\$\{encodeURIComponent\(reportKey\)\}/);
  assert.match(combined, /requireCustomerWorkspace/);
  assert.match(combined, /AbortSignal\.timeout/);
  assert.doesNotMatch(combined, /ADMIN_API_KEY|x-admin-key|access[_-]?token|client[_-]?secret/i);
});
