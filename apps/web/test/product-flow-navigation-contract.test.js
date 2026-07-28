import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { PRODUCT_ROUTES, productFlowLabel } from '../components/sdr/product-routes.js';

const builderPath = new URL('../components/sdr/BuilderSuiteClient.tsx', import.meta.url);
const actionsPath = new URL('../components/sdr/OpsActionsClient.tsx', import.meta.url);
const billingPath = new URL('../components/sdr/BillingLifecycleClient.tsx', import.meta.url);

test('product flow navigation exposes the main user journeys', () => {
  const routes = new Set(PRODUCT_ROUTES.map((route) => route.href));
  for (const route of ['/settings/readiness', '/settings/reconnect', '/dashboard', '/builder', '/settings/actions', '/settings/billing', '/setup']) {
    assert.ok(routes.has(route), `Expected product route ${route}`);
  }
  assert.match(productFlowLabel(), /Recommended flow/);
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
