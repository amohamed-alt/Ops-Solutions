import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const navPath = new URL('../components/sdr/ProductFlowNav.tsx', import.meta.url);
const builderPath = new URL('../components/sdr/BuilderSuiteClient.tsx', import.meta.url);
const actionsPath = new URL('../components/sdr/OpsActionsClient.tsx', import.meta.url);
const billingPath = new URL('../components/sdr/BillingLifecycleClient.tsx', import.meta.url);

test('product flow navigation exposes the main user journeys', async () => {
  const nav = await readFile(navPath, 'utf8');
  for (const route of ['/dashboard', '/builder', '/settings/actions', '/settings/billing', '/setup']) {
    assert.match(nav, new RegExp(route.replaceAll('/', '\\/')));
  }
  assert.match(nav, /Recommended flow/);
  assert.match(nav, /What this page does/);
});

test('builder actions and billing pages include shared product flow navigation', async () => {
  const builder = await readFile(builderPath, 'utf8');
  const actions = await readFile(actionsPath, 'utf8');
  const billing = await readFile(billingPath, 'utf8');

  for (const source of [builder, actions, billing]) {
    assert.match(source, /ProductFlowNav/);
    assert.match(source, /purpose=/);
    assert.match(source, /nextSteps=/);
  }

  assert.match(builder, /current="builder"/);
  assert.match(actions, /current="actions"/);
  assert.match(billing, /current="billing"/);
});
