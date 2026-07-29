import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceDirectory = path.resolve(testDirectory, '../src');

const CANONICAL_ANALYTICS_ROUTES = Object.freeze([
  '/api/v1/workspaces/:workspaceId/analytics/revenue',
  '/api/v1/workspaces/:workspaceId/analytics/revenue/drilldowns/:reportKey',
  '/api/v1/workspaces/:workspaceId/analytics/objects',
  '/api/v1/workspaces/:workspaceId/analytics/objects/:objectType',
  '/api/v1/workspaces/:workspaceId/analytics/objects/:objectType/drilldowns/:reportKey'
]);

async function source(name) {
  return readFile(path.join(sourceDirectory, name), 'utf8');
}

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await javascriptFiles(absolute));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(absolute);
    }
  }

  return files;
}

function literalRouteCount(content, route) {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...content.matchAll(new RegExp(`app\\.get\\(\\s*['\"\\x60]${escaped}['\"\\x60]`, 'g'))].length;
}

test('production composition gives the scoped registrar sole active ownership of canonical analytics routes', async () => {
  const [server, syncOperations, baseSyncOperations, scopedReporting] = await Promise.all([
    source('server.js'),
    source('sync-operations.js'),
    source('sync-operations-base.js'),
    source('scoped-revenue-reporting.js')
  ]);

  assert.match(
    server,
    /import\s*\{\s*registerSyncOperationsRoutes\s*\}\s*from\s*['"]\.\/sync-operations\.js['"]/,
    'the production server must compose routes through sync-operations.js'
  );
  assert.doesNotMatch(
    server,
    /sync-operations-base\.js/,
    'the production server must not bypass the canonical route-composition layer'
  );

  assert.match(
    syncOperations,
    /registerBaseSyncOperationsRoutes\(withoutLegacyRevenueRoutes\(app\),\s*dependencies\)/,
    'legacy base revenue routes must remain suppressed before base registration'
  );
  assert.match(
    syncOperations,
    /registerRevenueReportingRoutes\(app,\s*\{/,
    'the scoped reporting registrar must be mounted after the base routes'
  );

  const suppressedRevenueRoutes = [...syncOperations.matchAll(
    /['"](\/api\/v1\/workspaces\/:workspaceId\/analytics\/revenue(?:\/drilldowns\/:reportKey)?)['"]/g
  )].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(suppressedRevenueRoutes)].sort(),
    CANONICAL_ANALYTICS_ROUTES.slice(0, 2).sort(),
    'the compatibility proxy must suppress exactly the two legacy revenue paths'
  );

  assert.match(
    baseSyncOperations,
    /registerRevenueReportingRoutes\(app,\s*\{\s*postgres,\s*requireAdmin,\s*requireWorkspace\s*\}\)/,
    'the base module still declares the compatibility registrar that the proxy suppresses'
  );

  for (const route of CANONICAL_ANALYTICS_ROUTES) {
    assert.equal(
      literalRouteCount(scopedReporting, route),
      1,
      `the scoped registrar must declare ${route} exactly once`
    );
  }
});

test('legacy object registrar is unreachable from the production import graph', async () => {
  const files = await javascriptFiles(sourceDirectory);
  const importingFiles = [];

  for (const file of files) {
    if (file.endsWith(`${path.sep}object-reporting.js`)) continue;
    const content = await readFile(file, 'utf8');
    if (/import[\s\S]*?registerObjectReportingRoutes[\s\S]*?from\s*['"]\.\/object-reporting\.js['"]/.test(content)) {
      importingFiles.push(path.relative(sourceDirectory, file));
    }
  }

  assert.deepEqual(
    importingFiles,
    [],
    'no production source file may import the legacy object route registrar'
  );
});
