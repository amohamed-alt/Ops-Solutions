import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const files = {
  client: new URL('../app/onboarding/OnboardingClient.tsx', import.meta.url),
  status: new URL('../app/api/customer/onboarding/status/route.ts', import.meta.url),
  run: new URL('../app/api/customer/onboarding/run/route.ts', import.meta.url),
  start: new URL('../app/api/customer/hubspot/start/route.ts', import.meta.url)
};

async function source(key) {
  return readFile(files[key], 'utf8');
}

test('onboarding routes authorize the explicitly selected workspace', async () => {
  for (const key of ['status', 'run', 'start']) {
    const content = await source(key);
    assert.match(content, /searchParams\.get\('workspaceId'\)/);
    assert.match(content, /requireCustomerWorkspace\(request, requestedWorkspaceId\)/);
  }
});

test('HubSpot OAuth preserves the selected workspace through the callback', async () => {
  const content = await source('start');
  assert.match(content, /returnTo = `\/onboarding\?workspaceId=/);
  assert.match(content, /encodeURIComponent\(access\.workspace\.id\)/);

  const client = await source('client');
  assert.match(client, /callbackWorkspaceId !== activeWorkspaceId/);
});

test('onboarding UI scopes status, build and OAuth calls to the active workspace', async () => {
  const content = await source('client');
  assert.match(content, /session\.workspaces\?\.map/);
  assert.match(content, /selectWorkspace\(event\.target\.value\)/);
  assert.match(content, /onboarding\/status\$\{workspaceQuery\(workspaceId\)\}/);
  assert.match(content, /onboarding\/run\$\{workspaceQuery\(activeWorkspaceId\)\}/);
  assert.match(content, /hubspot\/start\$\{workspaceQuery\(activeWorkspaceId\)\}/);
});

test('bodyless discovery requests do not advertise an empty JSON body', async () => {
  const run = await source('run');
  assert.match(run, /hubspot\/discover`, \{[\s\S]*?method: 'POST',[\s\S]*?headers: internalAdminHeaders\(\),/);

  const session = await readFile(new URL('../app/api/customer/session.ts', import.meta.url), 'utf8');
  const helper = session.match(/export function internalAdminHeaders[\s\S]*?\n\}/)?.[0] ?? '';
  assert.doesNotMatch(helper, /'content-type': 'application\/json'/);
  assert.match(session, /internalAdminHeaders\(extra: Record<string, string> = \{\}\)/);
});

test('JSON onboarding requests explicitly send a JSON content type with a body', async () => {
  const run = await source('run');
  assert.match(run, /mappings\/[\s\S]*?headers: internalAdminHeaders\(\{ 'content-type': 'application\/json' \}\),[\s\S]*?body: JSON\.stringify/);
  assert.match(run, /\/sync`, \{[\s\S]*?headers: internalAdminHeaders\(\{ 'content-type': 'application\/json' \}\),[\s\S]*?body: JSON\.stringify/);
});
