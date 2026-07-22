import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';

import { buildRevenueCsvExport, resolveDatePreset } from './report-exports.js';
import { normalizeReportingFilters } from './revenue-reporting.js';

const EXPORT_ATTEMPTS = 3;
const EXPORTS_PER_HOUR = 10;
const MAX_LIST_LIMIT = 50;

function createRedisConnection(redisUrl, options) {
  return new Redis(redisUrl, options);
}

function requestError(message, category = 'INVALID_EXPORT_REQUEST', statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.category = category;
  return error;
}

function normalizeUuid(value, label) {
  const id = String(value ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw requestError(`${label} is invalid.`);
  }
  return id;
}

function cleanViewName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  return name ? name.slice(0, 100) : null;
}

export function normalizeBackgroundExportRequest(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw requestError('Export request must be an object.');
  }
  const format = String(input.format ?? 'csv').trim().toLowerCase();
  if (format !== 'csv') {
    throw requestError('Background XLSX and PDF exports are not available yet.', 'EXPORT_FORMAT_NOT_AVAILABLE');
  }
  const savedViewId = input.savedViewId ? normalizeUuid(input.savedViewId, 'Saved view ID') : null;
  const filters = input.filters ?? {};
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
    throw requestError('Export filters must be an object.');
  }
  return { format, savedViewId, filters, viewName: cleanViewName(input.viewName) };
}

export async function resolveBackgroundExportSelection(postgres, workspaceId, userId, input, now = new Date()) {
  const request = normalizeBackgroundExportRequest(input);
  if (!request.savedViewId) {
    return {
      ...request,
      filters: normalizeReportingFilters(request.filters, now)
    };
  }

  const result = await postgres.query(
    `SELECT id, name, date_preset, filters
     FROM saved_reporting_views
     WHERE id = $1 AND workspace_id = $2 AND user_id = $3
     LIMIT 1`,
    [request.savedViewId, workspaceId, userId]
  );
  if (result.rowCount === 0) {
    throw requestError('Saved reporting view not found.', 'SAVED_VIEW_NOT_FOUND', 404);
  }
  const view = result.rows[0];
  return {
    ...request,
    filters: resolveDatePreset(view.date_preset, view.filters ?? {}, now),
    viewName: view.name
  };
}

export async function enforceBackgroundExportRateLimit(redis, workspaceId, userId, now = Date.now()) {
  const bucket = Math.floor(now / 3_600_000);
  const key = `rate:background-export:${workspaceId}:${userId}:${bucket}`;
  const results = await redis.multi().incr(key).expire(key, 7_200).exec();
  const count = Number(results?.[0]?.[1] ?? 0);
  if (count > EXPORTS_PER_HOUR) {
    throw requestError('The hourly export limit has been reached.', 'EXPORT_RATE_LIMITED', 429);
  }
  return { limit: EXPORTS_PER_HOUR, remaining: Math.max(0, EXPORTS_PER_HOUR - count) };
}

function serializeExportJob(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    savedViewId: row.saved_view_id,
    format: row.format,
    status: row.status,
    filters: row.filters ?? {},
    viewName: row.view_name,
    fileName: row.file_name,
    contentType: row.content_type,
    fileSizeBytes: row.file_size_bytes,
    attempts: row.attempts,
    error: row.error,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    downloadReady: row.status === 'completed' && Number(row.file_size_bytes ?? 0) > 0
  };
}

const JOB_COLUMNS = `
  id, workspace_id, requested_by_user_id, saved_view_id, format, status,
  filters, view_name, file_name, content_type, file_size_bytes, attempts,
  error, queued_at, started_at, completed_at, expires_at, created_at, updated_at
`;

async function expireArtifacts(postgres, workspaceId = null, userId = null) {
  await postgres.query(
    `UPDATE report_export_jobs
     SET status = 'expired', artifact = NULL, updated_at = NOW()
     WHERE status = 'completed' AND expires_at <= NOW()
       AND ($1::uuid IS NULL OR workspace_id = $1)
       AND ($2::uuid IS NULL OR requested_by_user_id = $2)`,
    [workspaceId, userId]
  );
}

export async function processBackgroundExportJob(
  postgres,
  job,
  { buildExport = buildRevenueCsvExport } = {}
) {
  const exportJobId = normalizeUuid(job.data?.exportJobId, 'Export job ID');
  const workspaceId = normalizeUuid(job.data?.workspaceId, 'Workspace ID');
  const userId = normalizeUuid(job.data?.userId, 'User ID');
  const attempt = Number(job.attemptsMade ?? 0) + 1;

  const selected = await postgres.query(
    `SELECT e.*, w.name AS workspace_name
     FROM report_export_jobs e
     JOIN workspaces w ON w.id = e.workspace_id
     WHERE e.id = $1 AND e.workspace_id = $2 AND e.requested_by_user_id = $3
     LIMIT 1`,
    [exportJobId, workspaceId, userId]
  );
  if (selected.rowCount === 0) throw requestError('Export job not found.', 'EXPORT_NOT_FOUND', 404);
  const row = selected.rows[0];
  if (row.status === 'cancelled' || row.status === 'expired') return { status: row.status };
  if (row.status === 'completed' && row.artifact) return { status: 'completed', idempotent: true };

  await postgres.query(
    `UPDATE report_export_jobs
     SET status = 'processing', attempts = $2, started_at = COALESCE(started_at, NOW()),
         error = NULL, updated_at = NOW()
     WHERE id = $1 AND workspace_id = $3 AND requested_by_user_id = $4`,
    [exportJobId, attempt, workspaceId, userId]
  );

  try {
    const result = await buildExport(
      postgres,
      { id: workspaceId, name: row.workspace_name },
      { ...(row.filters ?? {}), viewName: row.view_name }
    );
    const artifact = Buffer.from(result.csv, 'utf8');
    await postgres.query(
      `UPDATE report_export_jobs
       SET status = 'completed', file_name = $2, content_type = $3,
           file_size_bytes = $4, artifact = $5, error = NULL,
           completed_at = NOW(), expires_at = NOW() + INTERVAL '24 hours', updated_at = NOW()
       WHERE id = $1 AND workspace_id = $6 AND requested_by_user_id = $7`,
      [
        exportJobId,
        result.fileName,
        'text/csv; charset=utf-8',
        artifact.byteLength,
        artifact,
        workspaceId,
        userId
      ]
    );
    return { status: 'completed', fileSizeBytes: artifact.byteLength };
  } catch (error) {
    const finalAttempt = attempt >= EXPORT_ATTEMPTS;
    await postgres.query(
      `UPDATE report_export_jobs
       SET status = $2, error = $3, updated_at = NOW()
       WHERE id = $1 AND workspace_id = $4 AND requested_by_user_id = $5`,
      [exportJobId, finalAttempt ? 'failed' : 'queued', 'Export generation failed.', workspaceId, userId]
    );
    throw error;
  }
}

export function registerBackgroundExportRoutes(app, {
  postgres,
  redis,
  redisUrl,
  requireViewer,
  requireWorkspace,
  writeAudit,
  QueueClass = Queue,
  WorkerClass = Worker,
  connectionFactory = createRedisConnection
}) {
  const queueConnection = connectionFactory(redisUrl, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true
  });
  const queue = new QueueClass('report-exports', {
    connection: queueConnection,
    defaultJobOptions: {
      attempts: EXPORT_ATTEMPTS,
      backoff: { type: 'exponential', delay: 15_000 },
      removeOnComplete: { age: 86_400, count: 2_000 },
      removeOnFail: { age: 604_800, count: 2_000 }
    }
  });
  let worker = null;
  let workerConnection = null;
  const basePath = '/api/v1/customer/workspaces/:workspaceId/exports';

  app.post(basePath, { preHandler: requireViewer }, async (request, reply) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    const userId = request.customer.user.id;
    const rateLimit = await enforceBackgroundExportRateLimit(redis, workspace.id, userId);
    const selection = await resolveBackgroundExportSelection(
      postgres,
      workspace.id,
      userId,
      request.body ?? {}
    );
    await expireArtifacts(postgres, workspace.id, userId);

    const created = await postgres.query(
      `INSERT INTO report_export_jobs (
         workspace_id, requested_by_user_id, saved_view_id, format, filters, view_name
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING ${JOB_COLUMNS}`,
      [
        workspace.id,
        userId,
        selection.savedViewId,
        selection.format,
        JSON.stringify(selection.filters),
        selection.viewName
      ]
    );
    const exportJob = created.rows[0];
    try {
      await queue.add('revenue-csv', {
        exportJobId: exportJob.id,
        workspaceId: workspace.id,
        userId
      }, { jobId: `export-${String(exportJob.id).replaceAll('-', '')}` });
    } catch (error) {
      await postgres.query(
        `UPDATE report_export_jobs
         SET status = 'failed', error = 'Export queue is unavailable.', updated_at = NOW()
         WHERE id = $1 AND workspace_id = $2 AND requested_by_user_id = $3`,
        [exportJob.id, workspace.id, userId]
      );
      throw error;
    }
    await writeAudit(request, {
      workspaceId: workspace.id,
      actorUserId: userId,
      action: 'report_export.queued',
      targetType: 'report_export_job',
      targetId: exportJob.id,
      metadata: { format: selection.format, savedViewId: selection.savedViewId }
    });
    reply
      .header('x-rate-limit-limit', String(rateLimit.limit))
      .header('x-rate-limit-remaining', String(rateLimit.remaining));
    return reply.code(202).send(serializeExportJob(exportJob));
  });

  app.get(basePath, { preHandler: requireViewer }, async (request) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    const userId = request.customer.user.id;
    await expireArtifacts(postgres, workspace.id, userId);
    const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, Number.parseInt(request.query?.limit ?? '20', 10) || 20));
    const result = await postgres.query(
      `SELECT ${JOB_COLUMNS}
       FROM report_export_jobs
       WHERE workspace_id = $1 AND requested_by_user_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [workspace.id, userId, limit]
    );
    return { results: result.rows.map(serializeExportJob) };
  });

  app.get(`${basePath}/:exportId`, { preHandler: requireViewer }, async (request) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    const exportId = normalizeUuid(request.params.exportId, 'Export job ID');
    const userId = request.customer.user.id;
    await expireArtifacts(postgres, workspace.id, userId);
    const result = await postgres.query(
      `SELECT ${JOB_COLUMNS}
       FROM report_export_jobs
       WHERE id = $1 AND workspace_id = $2 AND requested_by_user_id = $3
       LIMIT 1`,
      [exportId, workspace.id, userId]
    );
    if (result.rowCount === 0) throw requestError('Export job not found.', 'EXPORT_NOT_FOUND', 404);
    return serializeExportJob(result.rows[0]);
  });

  app.get(`${basePath}/:exportId/download`, { preHandler: requireViewer }, async (request, reply) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    const exportId = normalizeUuid(request.params.exportId, 'Export job ID');
    const userId = request.customer.user.id;
    await expireArtifacts(postgres, workspace.id, userId);
    const result = await postgres.query(
      `SELECT status, file_name, content_type, artifact, expires_at
       FROM report_export_jobs
       WHERE id = $1 AND workspace_id = $2 AND requested_by_user_id = $3
       LIMIT 1`,
      [exportId, workspace.id, userId]
    );
    if (result.rowCount === 0) throw requestError('Export job not found.', 'EXPORT_NOT_FOUND', 404);
    const exportJob = result.rows[0];
    if (exportJob.status === 'expired') {
      throw requestError('This export has expired. Generate a new one.', 'EXPORT_EXPIRED', 410);
    }
    if (exportJob.status !== 'completed' || !exportJob.artifact) {
      throw requestError('This export is not ready for download.', 'EXPORT_NOT_READY', 409);
    }
    await writeAudit(request, {
      workspaceId: workspace.id,
      actorUserId: userId,
      action: 'report_export.downloaded',
      targetType: 'report_export_job',
      targetId: exportId,
      metadata: { format: 'csv' }
    });
    return reply
      .header('content-type', exportJob.content_type || 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${exportJob.file_name || 'revenue-report.csv'}"`)
      .header('cache-control', 'private, no-store, max-age=0')
      .header('x-content-type-options', 'nosniff')
      .send(exportJob.artifact);
  });

  return {
    async start() {
      if (worker) return;
      workerConnection = connectionFactory(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true
      });
      worker = new WorkerClass(
        'report-exports',
        (job) => processBackgroundExportJob(postgres, job),
        {
          connection: workerConnection,
          concurrency: 1,
          lockDuration: 120_000,
          stalledInterval: 30_000,
          maxStalledCount: 2
        }
      );
      worker.on('failed', (job, error) => {
        app.log.error({ exportJobId: job?.data?.exportJobId, error }, 'Background export failed');
      });
      worker.on('error', (error) => app.log.error({ error }, 'Background export worker error'));
      await worker.waitUntilReady();
    },
    async close() {
      await Promise.allSettled([worker?.close(), queue.close()]);
      await Promise.allSettled([workerConnection?.quit(), queueConnection.quit()]);
    }
  };
}
