import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceDirectory = path.resolve(testDirectory, '../src');

const CANONICAL_ROUTES = Object.freeze([
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

test('production composition mounts the scoped reporting registrar as the canonical owner', async () => {
  const [server, syncOperations, scopedReporting] = await Promise.all([
    source('server.js'),
    source('sync-operations.js'),
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
    'the production server must not bypass the canonical composition layer'
  );
  assert.match(
    syncOperations,
    /registerRevenueReportingRoutes\(app,\s*\{/,
    'the scoped reporting registrar must be mounted by the production composition layer'
  );

  for (const route of CANONICAL_ROUTES) {
    assert.equal(
      literalRouteCount(scopedReporting, route),
      1,
      `the scoped registrar must declare ${route} exactly once`
    );
  }
});

test('legacy reporting registrars remain unreachable from production imports', async () => {
  const files = await javascriptFiles(sourceDirectory);
  const forbiddenImports = [];
  const patterns = [
    /import[\s\S]*?registerObjectReportingRoutes[\s\S]*?from\s*['"]\.\/object-reporting\.js['"]/,
    /import[\s\S]*?registerRevenueReportingRoutes[\s\S]*?from\s*['"]\.\/agreed-reporting-core\.js['"]/,
    /import[\s\S]*?registerRevenueReportingRoutes[\s\S]*?from\s*['"]\.\/revenue-reporting\.js['"]/,
    /import[\s\S]*?registerRevenueReportingRoutes[\s\S]*?from\s*['"]\.\/agreed-reporting\.js['"]/
  ];

  for (const file of files) {
    if (file.endsWith(`${path.sep}object-reporting.js`) || file.endsWith(`${path.sep}agreed-reporting-core.js`)) continue;
    const content = await readFile(file, 'utf8');
    if (patterns.some((pattern) => pattern.test(content))) {
      forbiddenImports.push(path.relative(sourceDirectory, file));
    }
  }

  assert.deepEqual(
    forbiddenImports,
    [],
    'legacy route registrars must not be imported by production source files'
  );
});
