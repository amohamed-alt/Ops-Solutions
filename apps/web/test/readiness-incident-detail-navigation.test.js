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

function section(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return text.slice(start, end);
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

test('dead-letter navigation fetches an incident outside the loaded cursor page', async () => {
  const page = await source(pageUrl);
  const openIncident = section(page, 'const openIncident=', '\n\n useEffect');

  assert.match(openIncident, /incidentDetailRequestRef/);
  assert.match(openIncident, /readiness-incidents\/\$\{encodeURIComponent\(incidentId\)\}/);
  assert.match(
    openIncident,
    /current\.some\(item\s*=>\s*item\.id\s*===\s*incident\.id\)\s*\?\s*current\s*:\s*\[incident,\s*\.\.\.current\]/
  );
  assert.match(openIncident, /requestAnimationFrame/);
  assert.match(openIncident, /focusIncident\(incident\.id\)/);
  assert.match(openIncident, /incidentDetailRequestRef\.current\?\.abort\(\)/);
  assert.match(page, /disabled=\{Boolean\(incidentDetailLoadingId\)\}/);
});

test('on-demand incident loading remains workspace-scoped and private', async () => {
  const page = await source(pageUrl);
  const proxy = await source(detailProxyUrl);
  const openIncident = section(page, 'const openIncident=', '\n\n useEffect');
  const implementation = `${proxy}\n${openIncident}`;

  assert.match(openIncident, /\/api\/customer\/workspaces\/\$\{workspaceId\}\/readiness-incidents/);
  assert.doesNotMatch(
    implementation,
    /recipient|emailBody|providerMessageId|accessToken|refreshToken|sessionToken|ipAddress/i
  );
});
