import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const files = {
  layout: new URL('components/legal/PublicPolicyLayout.js', root),
  privacy: new URL('app/privacy/page.js', root),
  terms: new URL('app/terms/page.js', root),
  security: new URL('app/security/page.js', root),
  support: new URL('app/support/page.js', root),
  deletion: new URL('app/data-deletion/page.js', root),
  sitemap: new URL('app/sitemap.js', root),
  robots: new URL('app/robots.js', root)
};

test('publishes all marketplace policy pages through one accessible layout', async () => {
  const source = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, url]) => [key, await readFile(url, 'utf8')])));
  for (const key of ['privacy', 'terms', 'security', 'support', 'deletion']) {
    assert.match(source[key], /PublicPolicyLayout/);
    assert.match(source[key], /export const metadata/);
  }
  for (const route of ['/privacy', '/terms', '/security', '/support', '/data-deletion']) {
    assert.match(source.layout, new RegExp(route.replace('/', '\\/')));
    assert.match(source.sitemap, new RegExp(route.replace('/', '\\/')));
  }
  assert.match(source.layout, /aria-label="Public information"/);
  assert.match(source.layout, /Contact support/);
});

test('privacy and deletion language preserves controller roles and verified authority', async () => {
  const [privacy, deletion] = await Promise.all([readFile(files.privacy, 'utf8'), readFile(files.deletion, 'utf8')]);
  assert.match(privacy, /customer remains the controller/);
  assert.match(privacy, /does not sell customer data/);
  assert.match(deletion, /workspace owner/);
  assert.match(deletion, /Never include passwords, OAuth tokens, session cookies, API credentials/);
  assert.match(deletion, /Removing the app from HubSpot stops authorization/);
});

test('crawler policy exposes public pages and protects authenticated application routes', async () => {
  const robots = await readFile(files.robots, 'utf8');
  assert.match(robots, /allow: \['\/', '\/privacy', '\/terms', '\/security', '\/support', '\/data-deletion'\]/);
  for (const route of ['/api/', '/dashboard/', '/settings/', '/onboarding']) assert.match(robots, new RegExp(route.replaceAll('/', '\\/')));
  assert.match(robots, /sitemap\.xml/);
});

test('public content never embeds production credentials or private administrative headers', async () => {
  const content = (await Promise.all(Object.values(files).map((url) => readFile(url, 'utf8')))).join('\n');
  assert.doesNotMatch(content, /ADMIN_API_KEY|x-admin-key|CLIENT_SECRET|ACCESS_TOKEN|REFRESH_TOKEN|RESEND_API_KEY|POSTMARK_SERVER_TOKEN/i);
});
