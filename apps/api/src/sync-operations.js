import {
  ensureHubSpotWebhookSchema,
  getHubSpotWebhookRollbackSql,
  jobNameForMode,
  normalizeHubSpotWebhookEvent,
  normalizeSyncMode,
  registerSyncOperationsRoutes as registerBaseSyncOperationsRoutes,
  validateHubSpotV3Signature
} from './sync-operations-base.js';
import {
  clearWorkspaceReportCache,
  registerRevenueReportingRoutes
} from './scoped-revenue-reporting.js';
import { startReportCacheInvalidationSubscriber } from './report-cache-invalidation.js';
import {
  ensureOnboardingReadinessSchema,
  evaluateAndPersistReadiness,
  evaluateWorkspaceOnboardingReadiness
} from './onboarding-readiness.js';

const LEGACY_REVENUE_ROUTES = new Set([
  '/api/v1/workspaces/:workspaceId/analytics/revenue',
  '/api/v1/workspaces/:workspaceId/analytics/revenue/drilldowns/:reportKey'
]);

function withoutLegacyRevenueRoutes(app) {
  return new Proxy(app, {
    get(target, property, receiver) {
      if (property === 'get') {
        return (path, ...args) => {
          if (LEGACY_REVENUE_ROUTES.has(path)) return undefined;
          return target.get(path, ...args);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function boundedHistoryLimit(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(100, parsed)) : 30;
}

function serializeReadinessSnapshot(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ready: row.ready,
    score: row.score,
    blockers: row.blockers,
    warnings: row.warnings,
    previousReady: row.previous_ready,
    transitioned: row.transitioned,
    triggerSource: row.trigger_source,
    policy: row.policy ?? {},
    checks: row.checks ?? [],
    nextActions: row.next_actions ?? [],
    generatedAt: row.generated_at,
    createdAt: row.created_at
  };
}

function registerReadinessOperationsRoutes(app, dependencies) {
  const basePath = '/api/v1/workspaces/:workspaceId/onboarding-readiness';
  const schemaReady = ensureOnboardingReadinessSchema(dependencies.postgres);

  app.get(basePath, { preHandler: dependencies.requireAdmin }, async (request) => {
    const workspace = await dependencies.requireWorkspace(request.params.workspaceId);
    return evaluateWorkspaceOnboardingReadiness(dependencies.postgres, workspace.id, {
      freshnessHours: request.query?.freshnessHours
    });
  });

  app.get(`${basePath}/history`, { preHandler: dependencies.requireAdmin }, async (request) => {
    const workspace = await dependencies.requireWorkspace(request.params.workspaceId);
    await schemaReady;
    const limit = boundedHistoryLimit(request.query?.limit);
    const transitionsOnly = String(request.query?.transitionsOnly ?? 'false') === 'true';
    const result = await dependencies.postgres.query(
      `SELECT id,workspace_id,ready,score,blockers,warnings,previous_ready,transitioned,
              trigger_source,policy,checks,next_actions,generated_at,created_at
       FROM onboarding_readiness_snapshots
       WHERE workspace_id=$1 ${transitionsOnly ? 'AND transitioned=TRUE' : ''}
       ORDER BY created_at DESC,id DESC LIMIT $2`,
      [workspace.id, limit]
    );
    return { results: result.rows.map(serializeReadinessSnapshot), limit, transitionsOnly };
  });

  app.post(`${basePath}/evaluate`, { preHandler: dependencies.requireAdmin }, async (request, reply) => {
    const workspace = await dependencies.requireWorkspace(request.params.workspaceId);
    await schemaReady;
    const report = await evaluateAndPersistReadiness({
      postgres: dependencies.postgres,
      withTransaction: dependencies.withTransaction,
      workspaceId: workspace.id,
      options: { freshnessHours: request.body?.freshnessHours },
      triggerSource: 'admin_api'
    });
    return reply.code(201).send(report);
  });
}

export function registerSyncOperationsRoutes(app, dependencies) {
  const result = registerBaseSyncOperationsRoutes(withoutLegacyRevenueRoutes(app), dependencies);
  registerRevenueReportingRoutes(app, {
    postgres: dependencies.postgres,
    requireAdmin: dependencies.requireAdmin,
    requireWorkspace: dependencies.requireWorkspace
  });
  registerReadinessOperationsRoutes(app, dependencies);

  const invalidationSubscriber = startReportCacheInvalidationSubscriber({
    redisUrl: dependencies.redisUrl,
    clearWorkspace: clearWorkspaceReportCache,
    log: app.log
  });

  return {
    async close() {
      await Promise.allSettled([
        Promise.resolve(result?.close?.()),
        invalidationSubscriber.close()
      ]);
    }
  };
}

export {
  ensureHubSpotWebhookSchema,
  getHubSpotWebhookRollbackSql,
  jobNameForMode,
  normalizeHubSpotWebhookEvent,
  normalizeSyncMode,
  validateHubSpotV3Signature
};
