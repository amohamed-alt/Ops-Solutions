import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const routeUrl = new URL('../app/api/customer/workspaces/[workspaceId]/readiness-incidents/route.ts', import.meta.url);

async function source() {
  return readFile(routeUrl, 'utf8');
}

test('forwards only allowlisted readiness incident filters', async () => {
  const text = await source();
  assert.match(text, /STATUS_VALUES/);
  assert.match(text, /SEVERITY_VALUES/);
  assert.match(text, /SORT_VALUES/);
  assert.match(text, /minimumBlockers/);
  assert.match(text, /cursor\.slice\(0, 2048\)/);
  assert.match(text, /query\.toString\(\)/);
});

test('keeps customer responses bounded and uncached', async () => {
  const text = await source();
  assert.match(text, /Math\.min\(maximum, parsed\)/);
  assert.match(text, /boundedInteger\(request\.nextUrl\.searchParams\.get\('limit'\), 25, 1, 50\)/);
  assert.match(text, /AbortSignal\.timeout\(20_000\)/);
  assert.match(text, /cache-control': 'no-store/);
});

test('preserves workspace authorization and secret isolation', async () => {
  const text = await source();
  assert.match(text, /requireCustomerWorkspace\(request, workspaceId\)/);
  assert.match(text, /encodeURIComponent\(workspaceId\)/);
  assert.doesNotMatch(text, /ADMIN_API_KEY|DATABASE_URL|RESEND_API_KEY|POSTMARK_SERVER_TOKEN/);
});
