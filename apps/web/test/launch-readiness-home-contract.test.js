import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pagePath = new URL('../app/page.js', import.meta.url);
const stylesPath = new URL('../app/page.module.css', import.meta.url);

test('home page exposes the connected launch readiness product map', async () => {
  const page = await readFile(pagePath, 'utf8');
  for (const route of ['/dashboard', '/builder', '/settings/actions', '/settings/billing', '/setup']) {
    assert.match(page, new RegExp(route.replaceAll('/', '\\/')));
  }
  assert.match(page, /LAUNCH READINESS/);
  assert.match(page, /Command Dashboard/);
  assert.match(page, /Analytics Builder/);
  assert.match(page, /Ops Actions/);
  assert.match(page, /Billing & Lifecycle/);
  assert.match(page, /Recommended flow/);
  assert.match(page, /READINESS CHECKLIST/);
});

test('home page does not describe the dashboard engine as future-only', async () => {
  const page = await readFile(pagePath, 'utf8');
  assert.doesNotMatch(page, /Dashboard Engine[\s\S]*Next/);
  assert.match(page, /Production dashboard restored/);
  assert.match(page, /Stripe\/Paddle live payments/);
  assert.match(page, /Needs provider setup/);
});

test('home page has launch readiness layout styles', async () => {
  const styles = await readFile(stylesPath, 'utf8');
  assert.match(styles, /heroActions/);
  assert.match(styles, /moduleLink/);
  assert.match(styles, /flowStep/);
  assert.match(styles, /readinessGrid/);
});
