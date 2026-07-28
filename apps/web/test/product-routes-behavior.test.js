import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRODUCT_FLOW,
  PRODUCT_ROUTES,
  productFlowLabel,
  productRoute
} from '../components/sdr/product-routes.js';

test('readiness and HubSpot access are first-class routes before operational pages', () => {
  const readiness = productRoute('readiness');
  const reconnect = productRoute('reconnect');
  assert.ok(readiness);
  assert.ok(reconnect);
  assert.equal(readiness.href, '/settings/readiness');
  assert.equal(reconnect.href, '/settings/reconnect');
  assert.match(readiness.description, /blockers|incidents|sync health/i);
  assert.match(reconnect.description, /scopes|permissions|reconnect/i);

  const readinessIndex = PRODUCT_ROUTES.findIndex((route) => route.key === 'readiness');
  const reconnectIndex = PRODUCT_ROUTES.findIndex((route) => route.key === 'reconnect');
  const dashboardIndex = PRODUCT_ROUTES.findIndex((route) => route.key === 'dashboard');
  assert.ok(readinessIndex >= 0);
  assert.ok(readinessIndex < reconnectIndex);
  assert.ok(reconnectIndex < dashboardIndex);
});

test('product route registry contains unique keys and hrefs', () => {
  const keys = PRODUCT_ROUTES.map((route) => route.key);
  const hrefs = PRODUCT_ROUTES.map((route) => route.href);

  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(hrefs).size, hrefs.length);
  assert.ok(PRODUCT_ROUTES.every((route) => route.label && route.description && route.href.startsWith('/')));
});

test('recommended product flow verifies HubSpot access before dashboard validation', () => {
  assert.ok(PRODUCT_FLOW.indexOf('Setup') < PRODUCT_FLOW.indexOf('Readiness'));
  assert.ok(PRODUCT_FLOW.indexOf('Readiness') < PRODUCT_FLOW.indexOf('HubSpot Access'));
  assert.ok(PRODUCT_FLOW.indexOf('HubSpot Access') < PRODUCT_FLOW.indexOf('Dashboard'));
  assert.equal(
    productFlowLabel(),
    'Recommended flow: Setup → Readiness → HubSpot Access → Dashboard → Builder → Email schedule → Ops Actions → Billing/Data lifecycle.'
  );
});
