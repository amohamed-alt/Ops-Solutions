import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const navigationPath = new URL('../components/customer/CustomerNavigation.tsx', import.meta.url);

test('dashboard owns its navigation and does not render the duplicate floating dock', async () => {
  const source = await readFile(navigationPath, 'utf8');
  assert.match(source, /const dashboardOwnsNavigation = pathname === '\/dashboard' \|\| pathname\.startsWith\('\/dashboard\/'\)/);
  assert.match(source, /const visible = !dashboardOwnsNavigation/);
  assert.match(source, /if \(!visible \|\| !session\?\.authenticated\) return null/);
});
