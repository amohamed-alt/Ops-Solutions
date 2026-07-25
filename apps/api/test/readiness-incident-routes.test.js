import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../src/sync-operations.js', import.meta.url);

async function source() {
  return readFile(sourceUrl, 'utf8');
}

test('registers tenant-scoped readiness incident list, detail and lifecycle routes', async () => {
  const text = await source();
  assert.match(text, /\/api\/v1\/workspaces\/:workspaceId\/readiness-incidents/);
  assert.match(text, /app\.get\(`\$\{basePath\}\/\:incidentId`/);
  assert.match(text, /for \(const action of \['acknowledge', 'resolve'\]\)/);
  assert.match(text, /:incidentId\/\$\{action\}/);
  assert.match(text, /preHandler: dependencies\.requireAdmin/g);
});

test('resolves workspace membership before listing, reading or mutating incidents', async () => {
  const text = await source();
  const routeSection = text.slice(text.indexOf('function registerReadinessIncidentRoutes'));
  assert.match(routeSection, /dependencies\.requireWorkspace\(request\.params\.workspaceId\)/);
  assert.match(routeSection, /workspaceId: workspace\.id/);
  assert.doesNotMatch(routeSection, /workspaceId: request\.params\.workspaceId/);
});

test('keeps incident list bounded and serializes only operational fields', async () => {
  const text = await source();
  const routeSection = text.slice(text.indexOf('function registerReadinessIncidentRoutes'));
  assert.match(routeSection, /listReadinessRegressionIncidentPage\(dependencies\.postgres/);
  assert.match(routeSection, /results:\s*page\.rows\.map\(serializeReadinessIncident\)/);
  assert.match(routeSection, /total:\s*page\.total/);
  assert.match(routeSection, /pageInfo:\s*page\.pageInfo/);
  assert.match(routeSection, /invalid_readiness_incident_query/);
  assert.doesNotMatch(routeSection, /access_token|refresh_token|client_secret|session_token|ip_address/i);
});

test('loads one incident with workspace and incident identifiers and safe errors', async () => {
  const text = await source();
  const routeSection = text.slice(text.indexOf('function registerReadinessIncidentRoutes'));
  assert.match(routeSection, /getReadinessRegressionIncident\(dependencies\.postgres/);
  assert.match(routeSection, /incidentId: request\.params\.incidentId/);
  assert.match(routeSection, /readiness_incident_not_found/);
  assert.match(routeSection, /invalid_readiness_incident_id/);
});

test('records an authenticated actor and optional note for lifecycle changes', async () => {
  const text = await source();
  assert.match(text, /request\.admin\?\.id \?\? request\.user\?\.id \?\? request\.auth\?\.subject/);
  assert.match(text, /actor: requestActor\(request\)/);
  assert.match(text, /note: request\.body\?\.note/);
});
