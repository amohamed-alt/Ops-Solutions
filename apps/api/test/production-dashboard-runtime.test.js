import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryRoot = new URL('../../../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, repositoryRoot), 'utf8');
}

test('production Redis preserves queue jobs and requires authentication', async () => {
  const compose = await source('docker-compose.prod.yml');
  assert.match(compose, /--maxmemory-policy(?:\s+|"\s*,\s*")noeviction/);
  assert.doesNotMatch(compose, /--maxmemory-policy(?:\s+|"\s*,\s*")allkeys-lru/);
  assert.match(compose, /--requirepass\s+"\$\$\{REDIS_PASSWORD\}"/);
  assert.match(compose, /redis-cli\s+-a\s+\\?"\$\$\{REDIS_PASSWORD\}\\?"\s+--no-auth-warning\s+ping/);
});

test('deployment verification compiles a tenant-scoped core revenue report', async () => {
  const verifier = await source('scripts/verify-production.sh');
  assert.match(verifier, /verify_internal_core_report\(\)/);
  assert.match(verifier, /reportUrl\.searchParams\.set\('scope', 'core'\)/);
  assert.match(verifier, /Core revenue report response contract is incomplete/);
  assert.match(verifier, /internal core revenue report failed/);
  assert.doesNotMatch(verifier, /console\.log\(adminKey\)/);
});

test('workspace status degradation is isolated per tenant', async () => {
  const route = await source('apps/web/app/api/customer/workspaces/route.ts');
  assert.match(route, /async function readInternalJson/);
  assert.match(route, /return response\.ok \? await response\.json\(\) : null/);
  assert.match(route, /const sync = syncResult \?\? EMPTY_SYNC_STATE/);
  assert.match(route, /degraded: setup === null \|\| syncResult === null/);
});

test('the customer dashboard proxy defaults to the bounded core report', async () => {
  const route = await source('apps/web/app/api/dashboard/[workspaceId]/reports/route.ts');
  assert.match(route, /if \(!target\.searchParams\.has\('scope'\)\) target\.searchParams\.set\('scope', 'core'\)/);
  assert.match(route, /AbortSignal\.timeout\(reportTimeoutMs\(target\.searchParams\.get\('scope'\)\)\)/);
});
