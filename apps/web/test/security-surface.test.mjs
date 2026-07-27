import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import nextConfig from '../next.config.mjs';

function headersFor(entries, source) {
  return Object.fromEntries(
    entries.find((entry) => entry.source === source)?.headers.map((header) => [header.key, header.value]) ?? []
  );
}

test('global responses include a production-safe content security policy', async () => {
  const entries = await nextConfig.headers();
  const headers = headersFor(entries, '/:path*');
  const policy = headers['Content-Security-Policy'];

  assert.ok(policy, 'Content-Security-Policy must be configured globally');
  assert.match(policy, /default-src 'self'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /base-uri 'self'/);
  assert.match(policy, /form-action 'self'/);
  assert.doesNotMatch(policy, /unsafe-eval/, 'production CSP must not allow unsafe-eval');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
});

test('private customer, dashboard, and operations APIs are never cached', async () => {
  const entries = await nextConfig.headers();

  for (const source of [
    '/api/customer/:path*',
    '/api/dashboard/:path*',
    '/api/operations/:path*'
  ]) {
    const headers = headersFor(entries, source);
    assert.equal(headers['Cache-Control'], 'no-store, max-age=0', `${source} must be no-store`);
    assert.equal(headers.Pragma, 'no-cache', `${source} must disable legacy caches`);
  }
});

test('request security middleware covers every private web API surface', async () => {
  const proxy = await readFile(new URL('../proxy.ts', import.meta.url), 'utf8');

  for (const matcher of [
    '/api/customer/:path*',
    '/api/dashboard/:path*',
    '/api/operations/:path*'
  ]) {
    assert.ok(proxy.includes(`'${matcher}'`), `${matcher} must be protected by proxy middleware`);
  }
});
