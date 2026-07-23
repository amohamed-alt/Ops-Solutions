import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pagePath = new URL('../app/dashboard/page.js', import.meta.url);
const layoutPath = new URL('../components/sdr/dashboard-layout-fix.css', import.meta.url);
const polishPath = new URL('../components/sdr/dashboard-product-polish.css', import.meta.url);

test('dashboard loads the final layout contract after product polish', async () => {
  const page = await readFile(pagePath, 'utf8');
  assert.match(page, /DashboardProductShell/);
  assert.match(page, /dashboard-layout-fix\.css/);
});

test('command center content is sized beside the fixed sidebar instead of centered beneath it', async () => {
  const layout = await readFile(layoutPath, 'utf8');
  const polish = await readFile(polishPath, 'utf8');

  assert.match(polish, /margin-inline:\s*auto/);
  assert.match(layout, /width:\s*calc\(100% - var\(--enterprise-sidebar\)\)/);
  assert.match(layout, /margin-left:\s*var\(--enterprise-sidebar\)/);
  assert.match(layout, /max-width:\s*none/);
  assert.match(layout, /overflow-x:\s*clip/);
  assert.match(layout, /\.ric-heading[\s\S]*padding:\s*clamp\(24px, 3vw, 42px\)/);
});

test('mobile layout removes the sidebar offset and cannot create horizontal page overflow', async () => {
  const layout = await readFile(layoutPath, 'utf8');

  assert.match(layout, /@media \(max-width: 760px\)/);
  assert.match(layout, /width:\s*100%/);
  assert.match(layout, /margin-left:\s*0/);
  assert.doesNotMatch(layout, /ADMIN_API_KEY|x-admin-key|access[_-]?token|client[_-]?secret/i);
});
