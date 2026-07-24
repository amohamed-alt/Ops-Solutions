import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  canonicalOrigin,
  evaluateCustomerRequestSecurity,
  isSafeHttpMethod,
  normalizeRequestId
} from '../lib/request-security.ts';

const proxyPath = new URL('../proxy.ts', import.meta.url);
const configPath = new URL('../next.config.mjs', import.meta.url);

test('allows safe customer requests without an Origin header', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    const result = evaluateCustomerRequestSecurity({ method, requestOrigin: 'https://ops.example.com' });
    assert.equal(result.allowed, true);
  }
  assert.equal(isSafeHttpMethod('post'), false);
});

test('allows same-origin mutations and preserves only safe request IDs', () => {
  const allowed = evaluateCustomerRequestSecurity({
    method: 'POST',
    requestOrigin: 'https://ops.example.com',
    originHeader: 'https://ops.example.com',
    fetchSite: 'same-origin',
    requestId: 'request-12345678'
  });
  assert.deepEqual(allowed, { allowed: true, requestId: 'request-12345678' });
  assert.equal(normalizeRequestId('unsafe request id').includes(' '), false);
});

test('blocks cross-site, missing-origin, and mismatched-origin mutations', () => {
  const crossSite = evaluateCustomerRequestSecurity({
    method: 'DELETE',
    requestOrigin: 'https://ops.example.com',
    originHeader: 'https://ops.example.com',
    fetchSite: 'cross-site'
  });
  assert.equal(crossSite.allowed, false);
  assert.equal(crossSite.error, 'cross_site_request_blocked');

  const missing = evaluateCustomerRequestSecurity({ method: 'POST', requestOrigin: 'https://ops.example.com' });
  assert.equal(missing.allowed, false);
  assert.equal(missing.error, 'origin_required');

  const mismatch = evaluateCustomerRequestSecurity({
    method: 'PATCH',
    requestOrigin: 'https://ops.example.com',
    originHeader: 'https://evil.example',
    fetchSite: 'same-site'
  });
  assert.equal(mismatch.allowed, false);
  assert.equal(mismatch.error, 'origin_mismatch');
});

test('canonical origins reject credentials and unsupported protocols', () => {
  assert.equal(canonicalOrigin('https://ops.example.com/path'), 'https://ops.example.com');
  assert.equal(canonicalOrigin('https://user:pass@ops.example.com'), null);
  assert.equal(canonicalOrigin('javascript:alert(1)'), null);
  assert.equal(canonicalOrigin('not a url'), null);
});

test('Next proxy covers only customer API routes and emits correlation IDs', async () => {
  const source = await readFile(proxyPath, 'utf8');
  assert.match(source, /matcher: \['\/api\/customer\/:path\*'\]/);
  assert.match(source, /request\.nextUrl\.origin/);
  assert.match(source, /sec-fetch-site/);
  assert.match(source, /x-request-id/);
  assert.match(source, /cache-control/);
  assert.doesNotMatch(source, /ADMIN_API_KEY|HUBSPOT_CLIENT_SECRET|ENCRYPTION_KEY/);
});

test('global web headers deny framing and disable sensitive browser capabilities', async () => {
  const source = await readFile(configPath, 'utf8');
  assert.match(source, /X-Frame-Options/);
  assert.match(source, /DENY/);
  assert.match(source, /Strict-Transport-Security/);
  assert.match(source, /includeSubDomains; preload/);
  assert.match(source, /camera=\(\), microphone=\(\), geolocation=\(\)/);
  assert.match(source, /source: '\/api\/customer\/:path\*'/);
  assert.match(source, /no-store, max-age=0/);
});
