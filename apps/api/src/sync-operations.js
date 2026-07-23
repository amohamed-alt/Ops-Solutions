import {
  ensureHubSpotWebhookSchema,
  getHubSpotWebhookRollbackSql,
  jobNameForMode,
  normalizeHubSpotWebhookEvent,
  normalizeSyncMode,
  registerSyncOperationsRoutes as registerBaseSyncOperationsRoutes,
  validateHubSpotV3Signature
} from './sync-operations-base.js';
import { registerRevenueReportingRoutes } from './scoped-revenue-reporting.js';

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

export function registerSyncOperationsRoutes(app, dependencies) {
  const result = registerBaseSyncOperationsRoutes(withoutLegacyRevenueRoutes(app), dependencies);
  registerRevenueReportingRoutes(app, {
    postgres: dependencies.postgres,
    requireAdmin: dependencies.requireAdmin,
    requireWorkspace: dependencies.requireWorkspace
  });
  return result;
}

export {
  ensureHubSpotWebhookSchema,
  getHubSpotWebhookRollbackSql,
  jobNameForMode,
  normalizeHubSpotWebhookEvent,
  normalizeSyncMode,
  validateHubSpotV3Signature
};
