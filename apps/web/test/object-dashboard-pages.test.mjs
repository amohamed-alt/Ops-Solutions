import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const componentPath = new URL('../components/sdr/ObjectDashboardPageClient.tsx', import.meta.url);
const routePath = new URL('../app/dashboard/objects/[objectType]/page.tsx', import.meta.url);
const indexPath = new URL('../app/dashboard/objects/page.tsx', import.meta.url);
const sectionPath = new URL('../app/dashboard/[section]/page.tsx', import.meta.url);
const dashboardPath = new URL('../app/dashboard/page.js', import.meta.url);
const navigationPath = new URL('../components/sdr/ObjectRouteNavigationEnhancer.tsx', import.meta.url);

test('object dashboards expose every supported standard HubSpot object as a stable route', async () => {
  const component = await readFile(componentPath, 'utf8');
  const route = await readFile(routePath, 'utf8');
  const index = await readFile(indexPath, 'utf8');

  for (const objectType of ['contacts', 'companies', 'deals', 'calls', 'meetings', 'tasks', 'tickets']) {
    assert.match(component, new RegExp(`'${objectType}'`));
  }
  assert.match(route, /isObjectDashboardType/);
  assert.match(route, /notFound\(\)/);
  assert.match(route, /ObjectDashboardPageClient objectType=\{objectType\}/);
  assert.match(index, /redirect\('\/dashboard\/objects\/contacts'\)/);
});

test('standalone object dashboards preserve tenant scoping and live HubSpot drill-downs', async () => {
  const component = await readFile(componentPath, 'utf8');

  assert.match(component, /\/api\/customer\/workspaces/);
  assert.match(component, /ops:last-dashboard-workspace/);
  assert.match(component, /\/api\/dashboard\/\$\{encodeURIComponent\(nextWorkspaceId\)\}\/objects/);
  assert.match(component, /drilldowns\/\$\{encodeURIComponent\(metric\.key\)\}/);
  assert.match(component, /Open in HubSpot/);
  assert.match(component, /exportSnapshot/);
  assert.match(component, /AbortController/);
});

test('command center links to the object pages without removing the embedded report pack', async () => {
  const dashboard = await readFile(dashboardPath, 'utf8');
  const navigation = await readFile(navigationPath, 'utf8');

  assert.match(dashboard, /ObjectIntelligenceWorkspace/);
  assert.match(dashboard, /ObjectRouteNavigationEnhancer/);
  assert.match(dashboard, /object-route-navigation\.css/);
  assert.match(navigation, /data-object-route-group/);
  assert.match(navigation, /\/dashboard\/objects\/\$\{type\}/);
});

test('business dashboard aliases remain stable and route to the existing command-center sections', async () => {
  const section = await readFile(sectionPath, 'utf8');
  for (const alias of ['executive', 'pipeline', 'activities', 'sources', 'team', 'revops', 'retention']) {
    assert.match(section, new RegExp(`${alias}:`));
  }
  assert.match(section, /notFound\(\)/);
  assert.match(section, /redirect\(target\)/);
});
