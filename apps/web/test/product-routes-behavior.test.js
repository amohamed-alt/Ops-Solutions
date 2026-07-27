import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRODUCT_FLOW,
  PRODUCT_ROUTES,
  productFlowLabel,
  productRoute
} from '../components/sdr/product-routes.js';

test('readiness is a first-class product route before operational pages', () => {
  const readiness = productRoute('readiness');
  assert.ok(readiness);
  assert.equal(readiness.href, '/settings/readiness');
  assert.match(readiness.description, /blockers|incidents|sync health/i);

  const readinessIndex = PRODUCT_ROUTES.findIndex((route) => route.key === 'readiness');
  const dashboardIndex = PRODUCT_ROUTES.findIndex((route) => route.key === 'dashboard');
  assert.ok(readinessIndex >= 0);
  assert.ok(readinessIndex < dashboardIndex);
});

test('product route registry contains unique keys and hrefs', () => {
  const keys = PRODUCT_ROUTES.map((route) => route.key);
  const hrefs = PRODUCT_ROUTES.map((route) => route.href);

  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(hrefs).size, hrefs.length);
  assert.ok(PRODUCT_ROUTES.every((route) => route.label && route.description && route.href.startsWith('/')));
});

test('recommended product flow requires readiness before dashboard validation', () => {
  assert.ok(PRODUCT_FLOW.indexOf('Setup') < PRODUCT_FLOW.indexOf('Readiness'));
  assert.ok(PRODUCT_FLOW.indexOf('Readiness') < PRODUCT_FLOW.indexOf('Dashboard'));
  assert.equal(
    productFlowLabel(),
    'Recommended flow: Setup → Readiness → Dashboard → Builder → Email schedule → Ops Actions → Billing/Data lifecycle.'
  );
});
