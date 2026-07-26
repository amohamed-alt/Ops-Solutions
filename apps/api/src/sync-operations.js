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
import {
  ensureReadinessRegressionSchema,
  transitionReadinessRegressionIncident
} from './readiness-regression-monitor.js';
import {
  getReadinessRegressionIncident,
  listReadinessRegressionIncidentPage
} from './readiness-incident-query.js';
import {
  getReadinessDeliveryDeadLetterStatus,
  requeueReadinessDelivery
} from './readiness-delivery-dead-letter.js';

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

function boundedDeliveryLimit(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(200, parsed)) : 50;
}

function requestActor(request) {
  const candidate = request.admin?.id ?? request.user?.id ?? request.auth?.subject ?? 'admin_api';
  return String(candidate).trim().slice(0, 160) || 'admin_api';
}

function serializeReadinessIncident(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    status: row.status,
    severity: row.severity,
    firstSnapshotId: row.first_snapshot_id,
    latestSnapshotId: row.latest_snapshot_id,
    firstDetectedAt: row.first_detected_at,
    lastDetectedAt: row.last_detected_at,
    lastNotifiedAt: row.last_notified_at,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    note: row.note,
    occurrences: row.occurrences,
    score: row.score,
    blockers: row.blockers,
    warnings: row.warnings,
    snapshotGeneratedAt: row.snapshot_generated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeDeadLetterResult(result) {
  return {
    scope: result.scope,
    workspaceId: result.workspaceId,
    maxAttempts: result.maxAttempts,
    summary: result.summary,
    deliveries: (result.deliveries || []).map((delivery) => ({
      id: delivery.id,
      incidentId: delivery.incidentId,
      snapshotId: delivery.snapshotId,
      kind: delivery.kind,
      attempts: delivery.attempts,
      error: delivery.error,
      nextAttemptAt: delivery.nextAttemptAt,
      createdAt: delivery.createdAt,
      updatedAt: delivery.updatedAt,
      incident: delivery.incident ? {
        id: delivery.incident.id,
        status: delivery.incident.status,
        severity: delivery.incident.severity,
        occurrences: delivery.incident.occurrences,
        score: delivery.incident.score,
        blockers: delivery.incident.blockers,
        warnings: delivery.incident.warnings,
        firstDetectedAt: delivery.incident.firstDetectedAt,
        lastDetectedAt: delivery.incident.lastDetectedAt,
        acknowledgedAt: delivery.incident.acknowledgedAt,
        resolvedAt: delivery.incident.resolvedAt
      } : null
    }))
  };
}

async function withDatabaseTransaction(postgres, callback) {
  const client = await postgres.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
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
      withTransaction: (callback) => withDatabaseTransaction(dependencies.postgres, callback),
      workspaceId: workspace.id,
      options: { freshnessHours: request.body?.freshnessHours },
      triggerSource: 'admin_api'
    });
    return reply.code(201).send(report);
  });
}

function registerReadinessIncidentRoutes(app, dependencies) {
  const basePath = '/api/v1/workspaces/:workspaceId/readiness-incidents';
  const schemaReady = ensureOnboardingReadinessSchema(dependencies.postgres)
    .then(() => ensureReadinessRegressionSchema(dependencies.postgres));

  app.get(basePath, { preHandler: dependencies.requireAdmin }, async (request, reply) => {
    const workspace = await dependencies.requireWorkspace(request.params.workspaceId);
    await schemaReady;
    try {
      const page = await listReadinessRegressionIncidentPage(dependencies.postgres, {
        workspaceId: workspace.id,
        status: request.query?.status,
        severity: request.query?.severity,
        minimumBlockers: request.query?.minimumBlockers,
        sort: request.query?.sort,
        limit: request.query?.limit,
        cursor: request.query?.cursor
      });
      return {
        results: page.rows.map(serializeReadinessIncident),
        total: page.total,
        filters: page.filters,
        pageInfo: page.pageInfo
      };
    } catch (error) {
      if (error instanceof TypeError) {
        return reply.code(400).send({ error: 'invalid_readiness_incident_query', message: error.message });
      }
      throw error;
    }
  });

  app.get(`${basePath}/:incidentId`, { preHandler: dependencies.requireAdmin }, async (request, reply) => {
    const workspace = await dependencies.requireWorkspace(request.params.workspaceId);
    await schemaReady;
    try {
      const incident = await getReadinessRegressionIncident(dependencies.postgres, {
        workspaceId: workspace.id,
        incidentId: request.params.incidentId
      });
      if (!incident) return reply.code(404).send({ error: 'readiness_incident_not_found' });
      return serializeReadinessIncident(incident);
    } catch (error) {
      if (error instanceof TypeError) {
        return reply.code(400).send({ error: 'invalid_readiness_incident_id', message: error.message });
      }
      throw error;
    }
  });

  for (const action of ['acknowledge', 'resolve']) {
    app.post(`${basePath}/:incidentId/${action}`, { preHandler: dependencies.requireAdmin }, async (request) => {
      const workspace = await dependencies.requireWorkspace(request.params.workspaceId);
      await schemaReady;
      const incident = await transitionReadinessRegressionIncident(dependencies.postgres, {
        action,
        workspaceId: workspace.id,
        incidentId: request.params.incidentId,
        actor: requestActor(request),
        note: request.body?.note
      });
      return serializeReadinessIncident(incident);
    });
  }
}

function registerReadinessDeadLetterRoutes(app, dependencies) {
  const basePath = '/api/v1/workspaces/:workspaceId/readiness-delivery-dead-letters';

  app.get(basePath, { preHandler: dependencies.requireAdmin }, async (request) => {
    const workspace = await dependencies.requireWorkspace(request.params.workspaceId);
    const limit = boundedDeliveryLimit(request.query?.limit);
    const result = await getReadinessDeliveryDeadLetterStatus(dependencies.postgres, {
      workspaceId: workspace.id,
      limit
    });
    return serializeDeadLetterResult(result);
  });

  app.post(`${basePath}/:deliveryId/requeue`, { preHandler: dependencies.requireAdmin }, async (request, reply) => {
    const workspace = await dependencies.requireWorkspace(request.params.workspaceId);
    const apply = request.body?.apply === true;
    const result = await requeueReadinessDelivery(dependencies.postgres, {
      workspaceId: workspace.id,
      deliveryId: request.params.deliveryId,
      apply
    });
    if (!result.found) return reply.code(404).send({ error: 'readiness_delivery_not_found' });
    if (!result.eligible) return reply.code(409).send({ error: 'readiness_delivery_not_eligible', ...result });
    return reply.code(apply ? 200 : 202).send({
      ...result,
      actor: requestActor(request)
    });
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
  registerReadinessIncidentRoutes(app, dependencies);
  registerReadinessDeadLetterRoutes(app, dependencies);

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
