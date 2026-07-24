import {
  buildRevenueReportingPack as buildCoreRevenueReportingPack
} from './revenue-reporting.js';
import {
  buildRevenueReportingPack as buildFullRevenueReportingPack,
  getRevenueDrilldown
} from './agreed-reporting.js';
import {
  buildObjectReportingOverview,
  buildObjectReportingDetail,
  getObjectReportingDrilldown
} from './object-reporting.js';
import {
  applyReportTimingHeaders,
  createReportCache,
  reportCacheKey
} from './report-cache.js';

const REPORT_SCOPES = new Set(['core', 'operating', 'full']);
const reportCache = createReportCache({ maxEntries: 750 });

const TTL_MS = Object.freeze({
  revenueCore: 30_000,
  revenueOperating: 60_000,
  revenueFull: 60_000,
  revenueDrilldown: 15_000,
  objectOverview: 30_000,
  objectDetail: 45_000,
  objectDrilldown: 15_000
});

export function normalizeRevenueReportScope(value) {
  const scope = String(value ?? '').trim().toLowerCase();
  return REPORT_SCOPES.has(scope) ? scope : 'full';
}

async function buildScopedRevenueReport(postgres, workspaceId, query = {}) {
  const scope = normalizeRevenueReportScope(query.scope);

  if (scope === 'core') {
    return buildCoreRevenueReportingPack(postgres, workspaceId, query);
  }

  const report = await buildFullRevenueReportingPack(postgres, workspaceId, query);
  if (scope !== 'operating') return report;

  return {
    generatedAt: report.generatedAt,
    filters: report.filters,
    operatingReports: report.operatingReports,
    drilldowns: report.drilldowns
  };
}

function ttlForScope(scope) {
  if (scope === 'core') return TTL_MS.revenueCore;
  if (scope === 'operating') return TTL_MS.revenueOperating;
  return TTL_MS.revenueFull;
}

async function cached(reply, { namespace, workspaceId, query, parts = [], ttlMs, loader }) {
  const result = await reportCache.execute({
    key: reportCacheKey(namespace, workspaceId, query, parts),
    ttlMs,
    query,
    loader
  });
  applyReportTimingHeaders(reply, result);
  return result.value;
}

export function registerRevenueReportingRoutes(app, { postgres, requireAdmin, requireWorkspace }) {
  app.get('/api/v1/workspaces/:workspaceId/analytics/revenue', { preHandler: requireAdmin }, async (request, reply) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    const scope = normalizeRevenueReportScope(request.query?.scope);
    const report = await cached(reply, {
      namespace: 'revenue',
      workspaceId: workspace.id,
      query: request.query ?? {},
      parts: [scope],
      ttlMs: ttlForScope(scope),
      loader: () => buildScopedRevenueReport(postgres, workspace.id, request.query ?? {})
    });
    return { workspace, scope, report };
  });

  app.get('/api/v1/workspaces/:workspaceId/analytics/revenue/drilldowns/:reportKey', { preHandler: requireAdmin }, async (request, reply) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    const reportKey = String(request.params.reportKey ?? '');
    const drilldown = await cached(reply, {
      namespace: 'revenue-drilldown',
      workspaceId: workspace.id,
      query: request.query ?? {},
      parts: [reportKey],
      ttlMs: TTL_MS.revenueDrilldown,
      loader: () => getRevenueDrilldown(postgres, workspace.id, reportKey, request.query ?? {})
    });
    return { workspaceId: workspace.id, drilldown };
  });

  app.get('/api/v1/workspaces/:workspaceId/analytics/objects', { preHandler: requireAdmin }, async (request, reply) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    const report = await cached(reply, {
      namespace: 'object-overview',
      workspaceId: workspace.id,
      query: request.query ?? {},
      ttlMs: TTL_MS.objectOverview,
      loader: () => buildObjectReportingOverview(postgres, workspace.id, request.query ?? {})
    });
    return { workspace, report };
  });

  app.get('/api/v1/workspaces/:workspaceId/analytics/objects/:objectType', { preHandler: requireAdmin }, async (request, reply) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    const objectType = String(request.params.objectType ?? '');
    const report = await cached(reply, {
      namespace: 'object-detail',
      workspaceId: workspace.id,
      query: request.query ?? {},
      parts: [objectType],
      ttlMs: TTL_MS.objectDetail,
      loader: () => buildObjectReportingDetail(postgres, workspace.id, objectType, request.query ?? {})
    });
    return { workspace, report };
  });

  app.get('/api/v1/workspaces/:workspaceId/analytics/objects/:objectType/drilldowns/:reportKey', { preHandler: requireAdmin }, async (request, reply) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    const objectType = String(request.params.objectType ?? '');
    const reportKey = String(request.params.reportKey ?? '');
    const drilldown = await cached(reply, {
      namespace: 'object-drilldown',
      workspaceId: workspace.id,
      query: request.query ?? {},
      parts: [objectType, reportKey],
      ttlMs: TTL_MS.objectDrilldown,
      loader: () => getObjectReportingDrilldown(postgres, workspace.id, objectType, reportKey, request.query ?? {})
    });
    return { workspaceId: workspace.id, drilldown };
  });
}

export function reportCacheStats() {
  return reportCache.stats();
}

export function clearWorkspaceReportCache(workspaceId) {
  reportCache.clearWorkspace(workspaceId);
}
