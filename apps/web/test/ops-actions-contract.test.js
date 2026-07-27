import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pagePath = new URL('../app/settings/actions/page.js', import.meta.url);
const clientPath = new URL('../components/sdr/OpsActionsClient.tsx', import.meta.url);

test('ops actions settings page exposes the guarded action client', async () => {
  const page = await readFile(pagePath, 'utf8');
  assert.match(page, /OpsActionsClient/);
  assert.match(page, /Guarded HubSpot write actions/);
});

test('ops actions client exposes create task, lifecycle update, and reviewed markers', async () => {
  const client = await readFile(clientPath, 'utf8');
  assert.match(client, /Create HubSpot task/);
  assert.match(client, /Update lifecycle stage/);
  assert.match(client, /Mark record as reviewed/);
  assert.match(client, /\/actions\/tasks/);
  assert.match(client, /\/lifecycle-stage/);
  assert.match(client, /\/actions\/records\/reviewed/);
  assert.match(client, /Needs reconnect/);
});
