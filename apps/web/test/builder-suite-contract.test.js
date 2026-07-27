import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pagePath = new URL('../app/builder/page.js', import.meta.url);
const clientPath = new URL('../components/sdr/BuilderSuiteClient.tsx', import.meta.url);

test('builder page exposes the report dashboard and email scheduling suite', async () => {
  const page = await readFile(pagePath, 'utf8');
  assert.match(page, /BuilderSuiteClient/);
  assert.match(page, /force-dynamic/);
});

test('builder suite persists reports and dashboards as saved views', async () => {
  const client = await readFile(clientPath, 'utf8');
  assert.match(client, /Report Builder/);
  assert.match(client, /Dashboard Builder/);
  assert.match(client, /Email Scheduling/);
  assert.match(client, /builderType: 'report'/);
  assert.match(client, /builderType: 'dashboard'/);
  assert.match(client, /\/api\/customer\/workspaces\/\$\{encodeURIComponent\(workspaceId\)\}\/saved-views/);
});

test('builder suite creates scheduled emails through existing report schedule API', async () => {
  const client = await readFile(clientPath, 'utf8');
  assert.match(client, /\/report-schedules/);
  assert.match(client, /deliveryMode: 'attachment'/);
  assert.match(client, /format: 'xlsx'/);
  assert.match(client, /Create email schedule/);
  assert.match(client, /Asia\/Riyadh/);
});
