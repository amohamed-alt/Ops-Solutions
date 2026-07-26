import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pagePath = new URL('../app/dashboard/page.js', import.meta.url);
const componentPath = new URL('../components/sdr/CommandCenterV2.tsx', import.meta.url);
const stylePath = new URL('../components/sdr/command-center-v2.css', import.meta.url);

test('dashboard loads the rebuilt command center instead of layered legacy shells', async () => {
  const page = await readFile(pagePath, 'utf8');
  assert.match(page, /CommandCenterV2/);
  assert.match(page, /PdfSnapshotAction/);
  assert.doesNotMatch(page, /ObjectIntelligenceWorkspace|ObjectRouteNavigationEnhancer|DashboardDensityControl/);
});

test('command center content is sized beside one fixed sidebar', async () => {
  const component = await readFile(componentPath, 'utf8');
  const styles = await readFile(stylePath, 'utf8');

  assert.match(component, /className="cc2-sidebar"/);
  assert.match(component, /className="cc2-main"/);
  assert.match(styles, /\.cc2-sidebar[\s\S]*position:\s*fixed/);
  assert.match(styles, /\.cc2-main\s*\{[\s\S]*margin-left:\s*244px/);
  assert.match(styles, /\.cc2-content[\s\S]*width:\s*min\(1720px, 100%\)/);
  assert.doesNotMatch(styles, /ADMIN_API_KEY|x-admin-key|access[_-]?token|client[_-]?secret/i);
});

test('mobile layout removes the sidebar offset and avoids horizontal page overflow', async () => {
  const styles = await readFile(stylePath, 'utf8');

  assert.match(styles, /@media \(max-width: 720px\)/);
  assert.match(styles, /\.cc2-sidebar\s*\{\s*display:\s*none/);
  assert.match(styles, /\.cc2-main\s*\{\s*margin-left:\s*0/);
  assert.match(styles, /\.cc2-drawer\s*\{[\s\S]*width:\s*min\(720px, 94vw\)/);
});
