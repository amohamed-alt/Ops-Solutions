import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../src/sync-operations.js', import.meta.url);

async function source() {
  return readFile(sourceUrl, 'utf8');
}

test('registers tenant-scoped readiness incident list and lifecycle routes', async () => {
  const text = await source();
  assert.match(text, /\/api\/v1\/workspaces\/:workspaceId\/readiness-incidents/);
  assert.match(text, /for \(const action of \['acknowledge', 'resolve'\]\)/);
  assert.match(text, /:incidentId\/\$\{action\}/);
  assert.match(text, /preHandler: dependencies\.requireAdmin/g);
});

test('resolves workspace membership before listing or mutating incidents', async () => {
  const text = await source();
  const routeSection = text.slice(text.indexOf('function registerReadinessIncidentRoutes'));
  assert.match(routeSection, /dependencies\.requireWorkspace\(request\.params\.workspaceId\)/);
  assert.match(routeSection, /workspaceId: workspace\.id/);
  assert.doesNotMatch(routeSection, /workspaceId: request\.params\.workspaceId/);
});

test('keeps incident list bounded and serializes only operational fields', async () => {
  const text = await source();
  assert.match(text, /Math\.max\(1, Math\.min\(200, parsed\)\)/);
  assert.match(text, /return \{ results: rows\.map\(serializeReadinessIncident\), limit \}/);
  assert.doesNotMatch(text, /access_token|refresh_token|client_secret|session_token|ip_address/i);
});

test('records an authenticated actor and optional note for lifecycle changes', async () => {
  const text = await source();
  assert.match(text, /request\.admin\?\.id \?\? request\.user\?\.id \?\? request\.auth\?\.subject/);
  assert.match(text, /actor: requestActor\(request\)/);
  assert.match(text, /note: request\.body\?\.note/);
});
