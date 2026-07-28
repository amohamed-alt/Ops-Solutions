#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const sourceRoot = path.resolve('apps/api/src');
const routePattern = /\bapp\.(get|post|put|patch|delete|options|head)\s*\(\s*(['"`])([^'"`]+)\2/g;

// Existing legacy ownership is documented here so CI prevents regression while
// the route-consolidation work is completed incrementally. New duplicates fail.
const legacyDuplicateRoutes = new Set([
  'GET /api/v1/workspaces/:workspaceId/analytics/objects',
  'GET /api/v1/workspaces/:workspaceId/analytics/objects/:objectType',
  'GET /api/v1/workspaces/:workspaceId/analytics/objects/:objectType/drilldowns/:reportKey',
  'GET /api/v1/workspaces/:workspaceId/analytics/revenue',
  'GET /api/v1/workspaces/:workspaceId/analytics/revenue/drilldowns/:reportKey'
]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(absolute));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(absolute);
    }
  }

  return files;
}

function lineNumber(content, offset) {
  return content.slice(0, offset).split('\n').length;
}

const registrations = new Map();
const files = await walk(sourceRoot);

for (const file of files) {
  const content = await readFile(file, 'utf8');
  for (const match of content.matchAll(routePattern)) {
    const method = match[1].toUpperCase();
    const route = match[3];
    if (route.includes('${')) continue;

    const key = `${method} ${route}`;
    const locations = registrations.get(key) ?? [];
    locations.push({
      file: path.relative(process.cwd(), file),
      line: lineNumber(content, match.index ?? 0)
    });
    registrations.set(key, locations);
  }
}

const duplicates = [...registrations.entries()]
  .filter(([, locations]) => locations.length > 1)
  .sort(([left], [right]) => left.localeCompare(right));

const unexpected = duplicates.filter(([route]) => !legacyDuplicateRoutes.has(route));
const staleAllowlist = [...legacyDuplicateRoutes].filter((route) => !duplicates.some(([key]) => key === route));

if (staleAllowlist.length > 0) {
  console.error('Remove resolved routes from the legacy duplicate allowlist:');
  for (const route of staleAllowlist) console.error(`  - ${route}`);
  process.exit(1);
}

if (unexpected.length > 0) {
  console.error('Unexpected duplicate API route registrations detected:');
  for (const [route, locations] of unexpected) {
    console.error(`\n${route}`);
    for (const location of locations) {
      console.error(`  - ${location.file}:${location.line}`);
    }
  }
  process.exit(1);
}

console.log(`API route registration contract passed (${registrations.size} literal routes checked, ${duplicates.length} documented legacy duplicates).`);
