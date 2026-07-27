import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pagePath = new URL('../app/dashboard/page.js', import.meta.url);
const rolloutPath = new URL('../components/sdr/DashboardCommandCenterRollout.tsx', import.meta.url);
const labelAwareCommandCenterPath = new URL('../components/sdr/RevenueCommandCenter.tsx', import.meta.url);

const requiredBreakdownKeys = [
  'contacts-by-lead-status',
  'contacts-by-lifecycle-stage',
  'contacts-by-country',
  'contacts-by-created-month',
  'companies-by-industry',
  'companies-by-country',
  'companies-by-employee-size',
  'companies-by-created-month'
];

test('the production dashboard routes through a controlled rollout wrapper', async () => {
  const page = await readFile(pagePath, 'utf8');
  assert.match(page, /DashboardCommandCenterRollout/);
  assert.match(page, /process\.env\.LABEL_AWARE_COMMAND_CENTER === 'true'/);
  assert.match(page, /labelAwareEnabled=\{labelAwareEnabled\}/);
  assert.doesNotMatch(page, /RevenueCommandCenter as CommandCenterV2/);
});

test('the rollout wrapper defaults to stable and exposes recovery actions for the enhanced dashboard', async () => {
  const component = await readFile(rolloutPath, 'utf8');
  assert.match(component, /CommandCenterV2 as StableCommandCenter/);
  assert.match(component, /RevenueCommandCenter as LabelAwareCommandCenter/);
  assert.match(component, /useState\(!labelAwareEnabled\)/, 'stable dashboard must remain the default unless the rollout flag is enabled');
  assert.match(component, /ROLLOUT_RECOVERY_TIMEOUT_MS = 20_000/);
  assert.match(component, /Retry enhanced dashboard/);
  assert.match(component, /Use stable dashboard/);
  assert.match(component, /role="alert"/);
  assert.match(component, /aria-live="assertive"/);
});

test('the label-aware command center remains available for controlled rollout', async () => {
  const component = await readFile(labelAwareCommandCenterPath, 'utf8');

  assert.match(component, /crmBreakdowns:/, 'the report contract must include CRM breakdowns');
  assert.match(component, /displayProperties\s*\|\|\s*row\.properties/, 'drilldowns must prefer HubSpot display labels');
  assert.match(component, /propertyLabels\?:/, 'drilldowns must accept property display labels');
  assert.match(component, /dataKey="label"/, 'charts must render labels instead of raw internal keys');
  assert.match(component, /<strong>\{row\.label\}<\/strong>/, 'outcome lists must render the supplied label');

  for (const reportKey of requiredBreakdownKeys) {
    assert.ok(
      component.includes(`'${reportKey}'`),
      `the label-aware command center must expose the ${reportKey} drilldown`
    );
  }
});
