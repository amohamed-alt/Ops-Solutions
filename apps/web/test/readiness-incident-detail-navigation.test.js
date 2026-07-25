import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageUrl = new URL('../app/settings/readiness/page.tsx', import.meta.url);
const detailProxyUrl = new URL(
  '../app/api/customer/workspaces/[workspaceId]/readiness-incidents/[incidentId]/route.ts',
  import.meta.url
);

async function source(url) {
  return readFile(url, 'utf8');
}

test('incident detail proxy preserves tenant membership and bounded upstream behavior', async () => {
  const proxy = await source(detailProxyUrl);
  assert.match(proxy, /requireCustomerWorkspace\(request,\s*workspaceId\)/);
  assert.match(proxy, /encodeURIComponent\(workspaceId\)/);
  assert.match(proxy, /encodeURIComponent\(incidentId\)/);
  assert.match(proxy, /cache:\s*'no-store'/);
  assert.match(proxy, /AbortSignal\.timeout\(20_000\)/);
  assert.match(proxy, /status:\s*503/);
  assert.doesNotMatch(proxy, /ADMIN_API_KEY|DATABASE_URL|RESEND_API_KEY|POSTMARK_SERVER_TOKEN/i);
});

test('dead-letter navigation fetches and focuses an incident outside the loaded cursor page', async () => {
  const page = await source(pageUrl);

  assert.match(page, /incidentDetailRequestRef/);
  assert.match(page, /readiness-incidents\/\$\{encodeURIComponent\(incidentId\)\}/);
  assert.match(page, /setIncidents\(current\s*=>\s*current\.some/);
  assert.match(page, /\[incident,\s*\.\.\.current\]/);
  assert.match(page, /requestAnimationFrame/);
  assert.match(page, /focusIncident\(incident\.id\)/);
  assert.match(page, /incidentDetailRequestRef\.current\?\.abort\(\)/);
  assert.match(page, /disabled=\{Boolean\(incidentDetailLoadingId\)\}/);
});

test('on-demand incident loading stays on the customer workspace proxy', async () => {
  const page = await source(pageUrl);

  assert.match(
    page,
    /\/api\/customer\/workspaces\/\$\{workspaceId\}\/readiness-incidents\/\$\{encodeURIComponent\(incidentId\)\}/
  );
  assert.doesNotMatch(page, /\/api\/v1\/workspaces\/\$\{workspaceId\}/);
});
