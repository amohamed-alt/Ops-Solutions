import { Queue } from 'bullmq';

const ALLOWED_MODES = new Set(['initial', 'incremental', 'full']);

export function normalizeSyncMode(value) {
  const mode = String(value ?? 'incremental').trim().toLowerCase();
  if (!ALLOWED_MODES.has(mode)) {
    const error = new Error('Sync mode must be one of: initial, incremental, full');
    error.statusCode = 400;
    error.category = 'INVALID_SYNC_MODE';
    throw error;
  }
  return mode;
}

export function jobNameForMode(mode) {
  return mode === 'initial'
    ? 'initial-sync'
    : mode === 'full'
      ? 'full-sync'
      : 'incremental-sync';
}

async function syncSchemaReady(postgres) {
  const result = await postgres.query(`
    SELECT
      to_regclass('public.sync_runs') IS NOT NULL AS sync_runs,
      to_regclass('public.sync_cursors') IS NOT NULL AS sync_cursors,
      to_regclass('public.crm_records') IS NOT NULL AS crm_records
  `);
  const row = result.rows[0] ?? {};
  return Boolean(row.sync_runs && row.sync_cursors && row.crm_records);
}

async function currentSyncState(postgres, workspaceId) {
  if (!await syncSchemaReady(postgres)) {
    return {
      initialized: false,
      activeRun: null,
      latestRun: null,
      cursors: [],
      recordCounts: [],
      freshness: null
    };
  }

  const [activeResult, latestResult, cursorsResult, countsResult, freshnessResult] = await Promise.all([
    postgres.query(
      `SELECT id, mode, status, object_types, summary, error, started_at, completed_at
       FROM sync_runs
       WHERE workspace_id = $1 AND status = 'running'
       ORDER BY started_at DESC
       LIMIT 1`,
      [workspaceId]
    ),
    postgres.query(
      `SELECT id, mode, status, object_types, summary, error, started_at, completed_at
       FROM sync_runs
       WHERE workspace_id = $1
       ORDER BY started_at DESC
       LIMIT 1`,
      [workspaceId]
    ),
    postgres.query(
      `SELECT object_type, last_modified_at, last_success_at,
              last_full_sync_at, last_incremental_sync_at, updated_at
       FROM sync_cursors
       WHERE workspace_id = $1
       ORDER BY object_type`,
      [workspaceId]
    ),
    postgres.query(
      `SELECT object_type, COUNT(*)::int AS count,
              COUNT(*) FILTER (WHERE archived = TRUE)::int AS archived_count
       FROM crm_records
       WHERE workspace_id = $1
       GROUP BY object_type
       ORDER BY object_type`,
      [workspaceId]
    ),
    postgres.query(
      `SELECT MAX(synced_at) AS newest_record_sync,
              MIN(synced_at) AS oldest_record_sync,
              COUNT(*)::bigint AS total_records
       FROM crm_records
       WHERE workspace_id = $1`,
      [workspaceId]
    )
  ]);

  return {
    initialized: true,
    activeRun: activeResult.rows[0] ?? null,
    latestRun: latestResult.rows[0] ?? null,
    cursors: cursorsResult.rows,
    recordCounts: countsResult.rows,
    freshness: freshnessResult.rows[0] ?? null
  };
}

export function registerSyncOperationsRoutes(app, {
  postgres,
  redisUrl,
  requireAdmin,
  requireWorkspace
}) {
  const queue = new Queue('hubspot-sync', {
    connection: {
      url: redisUrl,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true
    },
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: 86_400, count: 1000 },
      removeOnFail: { age: 604_800, count: 1000 }
    }
  });

  app.get('/api/v1/workspaces/:workspaceId/sync', { preHandler: requireAdmin }, async (request) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    return {
      workspace,
      ...(await currentSyncState(postgres, workspace.id))
    };
  });

  app.post('/api/v1/workspaces/:workspaceId/sync', { preHandler: requireAdmin }, async (request, reply) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    const mode = normalizeSyncMode(request.body?.mode);

    const connectionResult = await postgres.query(
      `SELECT status FROM hubspot_connections WHERE workspace_id = $1 LIMIT 1`,
      [workspace.id]
    );
    if (connectionResult.rowCount === 0 || connectionResult.rows[0].status !== 'connected') {
      return reply.code(409).send({
        error: 'hubspot_not_connected',
        message: 'A connected HubSpot portal is required before synchronization can be started.'
      });
    }

    if (await syncSchemaReady(postgres)) {
      const runningResult = await postgres.query(
        `SELECT id, mode, started_at
         FROM sync_runs
         WHERE workspace_id = $1 AND status = 'running'
         ORDER BY started_at DESC
         LIMIT 1`,
        [workspace.id]
      );
      if (runningResult.rowCount > 0) {
        return reply.code(409).send({
          error: 'sync_already_running',
          message: 'A synchronization run is already active for this workspace.',
          activeRun: runningResult.rows[0]
        });
      }
    }

    const jobName = jobNameForMode(mode);
    const bucket = Math.floor(Date.now() / 60_000);
    const jobId = `manual-${jobName}-${workspace.id.replaceAll('-', '')}-${bucket}`;
    const job = await queue.add(jobName, {
      workspaceId: workspace.id,
      requestedBy: 'bootstrap_admin',
      requestedAt: new Date().toISOString(),
      source: 'sync_operations_api'
    }, { jobId });

    return reply.code(202).send({
      status: 'queued',
      workspaceId: workspace.id,
      mode,
      jobName,
      jobId: String(job.id)
    });
  });

  return {
    close: () => queue.close()
  };
}
