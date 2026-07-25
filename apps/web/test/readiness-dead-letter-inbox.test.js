import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageUrl = new URL('../app/settings/readiness/page.tsx', import.meta.url);
const stylesUrl = new URL('../app/settings/readiness/readiness.module.css', import.meta.url);
const listProxyUrl = new URL('../app/api/customer/workspaces/[workspaceId]/readiness-delivery-dead-letters/route.ts', import.meta.url);
const requeueProxyUrl = new URL('../app/api/customer/workspaces/[workspaceId]/readiness-delivery-dead-letters/[deliveryId]/requeue/route.ts', import.meta.url);

async function source(url) { return readFile(url, 'utf8'); }

test('readiness center renders bounded dead-letter recovery controls', async () => {
  const page = await source(pageUrl);
  assert.match(page, /Failed readiness notifications/);
  assert.match(page, /Validate retry/);
  assert.match(page, /Schedule one retry/);
  assert.match(page, /previewedDeliveryIds/);
  assert.match(page, /readiness-delivery-dead-letters\?limit=50/);
});

test('failed deliveries render safe correlated incident context and navigation', async () => {
  const page = await source(pageUrl);
  const styles = await source(stylesUrl);
  assert.match(page, /type DeliveryIncident=/);
  assert.match(page, /incident\?:DeliveryIncident\|null/);
  assert.match(page, /CORRELATED INCIDENT/);
  assert.match(page, /incident\.blockers/);
  assert.match(page, /incident\.occurrences/);
  assert.match(page, /openIncident\(incident\.id\)/);
  assert.match(page, /window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\?'auto':'smooth'/);
  assert.match(page, /scrollIntoView\(\{behavior:/);
  assert.match(page, /tabIndex=\{-1\}/);
  assert.match(page, /The historical incident is unavailable/);
  assert.match(styles, /\.focusedIncident/);
  assert.match(styles, /@media\(prefers-reduced-motion:reduce\)/);
});

test('dead-letter list proxy validates workspace access and bounds results', async () => {
  const proxy = await source(listProxyUrl);
  assert.match(proxy, /requireCustomerWorkspace\(request, workspaceId\)/);
  assert.match(proxy, /Math\.max\(1, Math\.min\(200, requestedLimit\)\)/);
  assert.match(proxy, /encodeURIComponent\(workspaceId\)/);
  assert.match(proxy, /AbortSignal\.timeout\(20_000\)/);
  assert.match(proxy, /cache: 'no-store'/);
});

test('requeue proxy requires owner or admin and remains dry-run by default', async () => {
  const proxy = await source(requeueProxyUrl);
  assert.match(proxy, /\['owner', 'admin'\]\.includes/);
  assert.match(proxy, /const apply = body\.apply === true/);
  assert.match(proxy, /JSON\.stringify\(\{ apply \}\)/);
  assert.match(proxy, /encodeURIComponent\(deliveryId\)/);
  assert.doesNotMatch(proxy, /bulk|requeue-all/i);
});

test('dead-letter UI and proxies exclude secret-bearing fields', async () => {
  const text = [await source(pageUrl), await source(listProxyUrl), await source(requeueProxyUrl)].join('\n');
  assert.doesNotMatch(text, /ADMIN_API_KEY|RESEND_API_KEY|POSTMARK_SERVER_TOKEN|DATABASE_URL|accessToken|refreshToken|sessionToken|ipAddress|recipient|providerMessageId/i);
});