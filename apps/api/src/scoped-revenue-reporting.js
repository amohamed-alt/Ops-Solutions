import {
  buildRevenueReportingPack as buildCoreRevenueReportingPack
} from './revenue-reporting.js';
import {
  buildRevenueReportingPack as buildFullRevenueReportingPack,
  getRevenueDrilldown
} from './agreed-reporting.js';

const REPORT_SCOPES = new Set(['core', 'operating', 'full']);

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

export function registerRevenueReportingRoutes(app, { postgres, requireAdmin, requireWorkspace }) {
  app.get('/api/v1/workspaces/:workspaceId/analytics/revenue', { preHandler: requireAdmin }, async (request) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    const scope = normalizeRevenueReportScope(request.query?.scope);
    return {
      workspace,
      scope,
      report: await buildScopedRevenueReport(postgres, workspace.id, request.query ?? {})
    };
  });

  app.get('/api/v1/workspaces/:workspaceId/analytics/revenue/drilldowns/:reportKey', { preHandler: requireAdmin }, async (request) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    return {
      workspaceId: workspace.id,
      drilldown: await getRevenueDrilldown(
        postgres,
        workspace.id,
        String(request.params.reportKey ?? ''),
        request.query ?? {}
      )
    };
  });
}
