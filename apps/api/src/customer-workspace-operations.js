import { Queue } from 'bullmq';

import { jobNameForMode, normalizeSyncMode } from './sync-operations.js';

function syncSchemaReadyRow(row = {}) {
  return Boolean(row.sync_runs && row.sync_cursors && row.crm_records);
}

export function classifyWorkspaceHealth({ connectionStatus, activeRun, latestRun, totalRecords, newestRecordSync, lastError }) {
  if (connectionStatus !== 'connected') return { status: 'disconnected', severity: 'critical', message: 'HubSpot is not connected.' };
  if (activeRun) return { status: 'syncing', severity: 'info', message: `A ${activeRun.mode || 'CRM'} sync is currently running.` };
  if (lastError || latestRun?.status === 'failed') return { status: 'degraded', severity: 'warning', message: lastError || latestRun?.error || 'The latest synchronization failed.' };
  if (!Number(totalRecords || 0)) return { status: 'initializing', severity: 'warning', message: 'HubSpot is connected but no CRM records have been synchronized yet.' };
  const freshnessMs = newestRecordSync ? Date.now() - new Date(newestRecordSync).getTime() : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(freshnessMs) || freshnessMs > 24 * 60 * 60 * 1000) {
    return { status: 'stale', severity: 'warning', message: 'CRM data has not been refreshed during the last 24 hours.' };
  }
  return { status: 'healthy', severity: 'success', message: 'HubSpot connection and synchronized data are healthy.' };
}

async function readWorkspaceOperations(postgres, workspaceId) {
  const schemaResult = await postgres.query(`
    SELECT
      to_regclass('public.sync_runs') IS NOT NULL AS sync_runs,
      to_regclass('public.sync_cursors') IS NOT NULL AS sync_cursors,
      to_regclass('public.crm_records') IS NOT NULL AS crm_records
  `);
  const syncReady = syncSchemaReadyRow(schemaResult.rows[0]);

  const connectionPromise = postgres.query(
    `SELECT portal_id, status, scopes, connected_at, last_discovered_at, last_error, token_expires_at, updated_at
     FROM hubspot_connections WHERE workspace_id = $1 LIMIT 1`,
    [workspaceId]
  );
  const mappingPromise = postgres.query(
    `SELECT
       COUNT(*)::int AS approved,
       COUNT(*) FILTER (WHERE source = 'user_approved')::int AS manually_approved
     FROM property_mappings WHERE workspace_id = $1`,
    [workspaceId]
  );
  const discoveryPromise = postgres.query(
    `SELECT status, summary, error, started_at, completed_at
     FROM discovery_runs WHERE workspace_id = $1 ORDER BY started_at DESC LIMIT 1`,
    [workspaceId]
  );

  const syncPromise = syncReady
    ? Promise.all([
        postgres.query(
          `SELECT id, mode, status, object_types, summary, error, started_at, completed_at
           FROM sync_runs WHERE workspace_id = $1 AND status = 'running' ORDER BY started_at DESC LIMIT 1`,
          [workspaceId]
        ),
        postgres.query(
          `SELECT id, mode, status, object_types, summary, error, started_at, completed_at
           FROM sync_runs WHERE workspace_id = $1 ORDER BY started_at DESC LIMIT 1`,
          [workspaceId]
        ),
        postgres.query(
          `SELECT object_type, COUNT(*)::int AS count,
                  COUNT(*) FILTER (WHERE archived = TRUE)::int AS archived_count,
                  MAX(synced_at) AS newest_sync
           FROM crm_records WHERE workspace_id = $1 GROUP BY object_type ORDER BY object_type`,
          [workspaceId]
        ),
        postgres.query(
          `SELECT COUNT(*)::bigint AS total_records, MAX(synced_at) AS newest_record_sync,
                  MIN(synced_at) AS oldest_record_sync
           FROM crm_records WHERE workspace_id = $1`,
          [workspaceId]
        )
      ])
    : Promise.resolve([{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [{ total_records: 0, newest_record_sync: null, oldest_record_sync: null }] }]);

  const [connectionResult, mappingResult, discoveryResult, syncResults] = await Promise.all([
    connectionPromise,
    mappingPromise,
    discoveryPromise,
    syncPromise
  ]);
  const [activeResult, latestResult, recordCountsResult, freshnessResult] = syncResults;
  const connection = connectionResult.rows[0] ?? null;
  const latestRun = latestResult.rows[0] ?? null;
  const activeRun = activeResult.rows[0] ?? null;
  const freshness = freshnessResult.rows[0] ?? { total_records: 0, newest_record_sync: null, oldest_record_sync: null };
  const health = classifyWorkspaceHealth({
    connectionStatus: connection?.status,
    activeRun,
    latestRun,
    totalRecords: freshness.total_records,
    newestRecordSync: freshness.newest_record_sync,
    lastError: connection?.last_error
  });

  return {
    health,
    connection: connection ? {
      portalId: Number(connection.portal_id),
      status: connection.status,
      scopes: connection.scopes ?? [],
      connectedAt: connection.connected_at,
      tokenExpiresAt: connection.token_expires_at,
      lastDiscoveredAt: connection.last_discovered_at,
      lastError: connection.last_error,
      updatedAt: connection.updated_at
    } : null,
    discovery: discoveryResult.rows[0] ?? null,
    mappings: mappingResult.rows[0] ?? { approved: 0, manually_approved: 0 },
    sync: {
      initialized: syncReady,
      activeRun,
      latestRun,
      recordCounts: recordCountsResult.rows,
      freshness
    }
  };
}

export function registerCustomerWorkspaceOperationRoutes(app, {
  postgres,
  redisUrl,
  requireViewer,
  requireAdmin,
  requireOwner,
  discoverWorkspacePortal,
  writeAudit
}) {
  const queue = new Queue('hubspot-sync', {
    connection: { url: redisUrl, maxRetriesPerRequest: 3, enableReadyCheck: true },
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: 86_400, count: 1000 },
      removeOnFail: { age: 604_800, count: 1000 }
    }
  });

  app.get('/api/v1/customer/workspaces/:workspaceId/operations', { preHandler: requireViewer }, async (request) => ({
    workspace: request.workspaceMembership,
    ...(await readWorkspaceOperations(postgres, request.params.workspaceId))
  }));

  app.post('/api/v1/customer/workspaces/:workspaceId/operations/discover', { preHandler: requireAdmin }, async (request, reply) => {
    const connectionResult = await postgres.query(
      `SELECT status FROM hubspot_connections WHERE workspace_id = $1 LIMIT 1`,
      [request.params.workspaceId]
    );
    if (connectionResult.rows[0]?.status !== 'connected') {
      return reply.code(409).send({ error: 'hubspot_not_connected', message: 'Reconnect HubSpot before running CRM discovery.' });
    }
    const summary = await discoverWorkspacePortal(request.params.workspaceId);
    await writeAudit(request, {
      workspaceId: request.params.workspaceId,
      actorUserId: request.customer.user.id,
      action: 'hubspot.discovery_completed',
      targetType: 'workspace',
      targetId: request.params.workspaceId,
      metadata: { source: 'customer_workspace_settings', summary }
    });
    return { status: 'completed', summary };
  });

  app.post('/api/v1/customer/workspaces/:workspaceId/operations/sync', { preHandler: requireAdmin }, async (request, reply) => {
    const mode = normalizeSyncMode(request.body?.mode);
    const connectionResult = await postgres.query(
      `SELECT status FROM hubspot_connections WHERE workspace_id = $1 LIMIT 1`,
      [request.params.workspaceId]
    );
    if (connectionResult.rows[0]?.status !== 'connected') {
      return reply.code(409).send({ error: 'hubspot_not_connected', message: 'Reconnect HubSpot before starting synchronization.' });
    }

    const schemaResult = await postgres.query(`SELECT to_regclass('public.sync_runs') IS NOT NULL AS ready`);
    if (schemaResult.rows[0]?.ready) {
      const running = await postgres.query(
        `SELECT id, mode, started_at FROM sync_runs
         WHERE workspace_id = $1 AND status = 'running' ORDER BY started_at DESC LIMIT 1`,
        [request.params.workspaceId]
      );
      if (running.rowCount > 0) {
        return reply.code(409).send({ error: 'sync_already_running', message: 'A synchronization run is already active.', activeRun: running.rows[0] });
      }
    }

    const jobName = jobNameForMode(mode);
    const bucket = Math.floor(Date.now() / 60_000);
    const jobId = `customer-${jobName}-${request.params.workspaceId.replaceAll('-', '')}-${bucket}`;
    const job = await queue.add(jobName, {
      workspaceId: request.params.workspaceId,
      requestedBy: request.customer.user.id,
      requestedAt: new Date().toISOString(),
      source: 'customer_workspace_settings'
    }, { jobId });
    await writeAudit(request, {
      workspaceId: request.params.workspaceId,
      actorUserId: request.customer.user.id,
      action: 'hubspot.sync_queued',
      targetType: 'sync_job',
      targetId: String(job.id),
      metadata: { mode, source: 'customer_workspace_settings' }
    });
    return reply.code(202).send({ status: 'queued', mode, jobName, jobId: String(job.id) });
  });

  app.post('/api/v1/customer/workspaces/:workspaceId/operations/disconnect', { preHandler: requireOwner }, async (request, reply) => {
    const result = await postgres.query(
      `UPDATE hubspot_connections
       SET status = 'disconnected', last_error = NULL, updated_at = NOW()
       WHERE workspace_id = $1 AND status <> 'disconnected'
       RETURNING portal_id, status, updated_at`,
      [request.params.workspaceId]
    );
    if (result.rowCount === 0) {
      return reply.code(409).send({ error: 'already_disconnected', message: 'This workspace is already disconnected from HubSpot.' });
    }
    await writeAudit(request, {
      workspaceId: request.params.workspaceId,
      actorUserId: request.customer.user.id,
      action: 'hubspot.disconnected',
      targetType: 'portal',
      targetId: String(result.rows[0].portal_id),
      metadata: { source: 'customer_workspace_settings', localOnly: true }
    });
    return { status: 'disconnected', portalId: Number(result.rows[0].portal_id), updatedAt: result.rows[0].updated_at };
  });

  return { close: () => queue.close() };
}
