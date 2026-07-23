import { Queue } from 'bullmq';

import { ensureHubSpotWebhookSchema, jobNameForMode } from './sync-operations.js';

const STATUSES = new Set(['received', 'queued', 'ignored', 'failed']);
const ACTIONS = new Set(['created', 'changed', 'deleted', 'association_changed']);
const MAX_RETRY_EVENTS = 100;

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

function normalizeStatus(value) {
  const status = String(value ?? '').trim().toLowerCase();
  return STATUSES.has(status) ? status : '';
}

function modeForEvents(events) {
  return events.some((event) => event.action === 'association_changed' || event.action === 'deleted')
    ? 'full'
    : 'incremental';
}

export function registerWebhookOperationsRoutes(app, {
  postgres,
  redisUrl,
  requireViewer,
  requireAdmin,
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
  const schemaReady = ensureHubSpotWebhookSchema(postgres);

  app.get('/api/v1/customer/workspaces/:workspaceId/webhooks', { preHandler: requireViewer }, async (request) => {
    await schemaReady;
    const workspaceId = request.params.workspaceId;
    const limit = boundedInteger(request.query?.limit, 50, 1, 100);
    const offset = boundedInteger(request.query?.offset, 0, 0, 10_000);
    const status = normalizeStatus(request.query?.status);
    const objectType = String(request.query?.objectType ?? '').trim().toLowerCase().slice(0, 40);
    const values = [workspaceId, limit, offset];
    const filters = [];
    if (status) {
      values.push(status);
      filters.push(`status = $${values.length}`);
    }
    if (objectType) {
      values.push(objectType);
      filters.push(`object_type = $${values.length}`);
    }
    const where = filters.length ? `AND ${filters.join(' AND ')}` : '';

    const [eventsResult, summaryResult] = await Promise.all([
      postgres.query(
        `SELECT id, event_id, subscription_type, object_type, object_id, action,
                property_name, attempt_number, occurred_at, status, error,
                received_at, processed_at, updated_at
         FROM hubspot_webhook_events
         WHERE workspace_id = $1 ${where}
         ORDER BY received_at DESC
         LIMIT $2 OFFSET $3`,
        values
      ),
      postgres.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
                COUNT(*) FILTER (WHERE status = 'received')::int AS pending,
                COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
                COUNT(*) FILTER (WHERE status = 'ignored')::int AS ignored,
                MAX(received_at) AS latest_received_at,
                MAX(processed_at) AS latest_processed_at
         FROM hubspot_webhook_events
         WHERE workspace_id = $1`,
        [workspaceId]
      )
    ]);

    return {
      results: eventsResult.rows,
      summary: summaryResult.rows[0],
      pagination: { limit, offset, hasMore: eventsResult.rows.length === limit }
    };
  });

  app.post('/api/v1/customer/workspaces/:workspaceId/webhooks/retry', { preHandler: requireAdmin }, async (request, reply) => {
    await schemaReady;
    const workspaceId = request.params.workspaceId;
    const ids = Array.isArray(request.body?.eventIds)
      ? [...new Set(request.body.eventIds.map((value) => String(value).trim()).filter(Boolean))].slice(0, MAX_RETRY_EVENTS)
      : [];
    const retryAllFailed = request.body?.allFailed === true;
    if (!retryAllFailed && ids.length === 0) {
      return reply.code(400).send({ error: 'webhook_events_required', message: 'Choose at least one webhook event to retry.' });
    }

    const result = retryAllFailed
      ? await postgres.query(
          `SELECT id, action, object_type, object_id
           FROM hubspot_webhook_events
           WHERE workspace_id = $1 AND status IN ('failed', 'received')
             AND received_at >= NOW() - INTERVAL '7 days'
           ORDER BY received_at ASC
           LIMIT $2`,
          [workspaceId, MAX_RETRY_EVENTS]
        )
      : await postgres.query(
          `SELECT id, action, object_type, object_id
           FROM hubspot_webhook_events
           WHERE workspace_id = $1 AND id = ANY($2::uuid[])
             AND status IN ('failed', 'received')`,
          [workspaceId, ids]
        );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: 'no_retryable_webhooks', message: 'No retryable webhook events were found.' });
    }

    const mode = modeForEvents(result.rows);
    const jobName = jobNameForMode(mode);
    const bucket = Math.floor(Date.now() / 30_000);
    const job = await queue.add(jobName, {
      workspaceId,
      requestedAt: new Date().toISOString(),
      requestedBy: request.customer.user.id,
      source: 'webhook_recovery',
      webhookEventIds: result.rows.map((row) => row.id),
      eventCount: result.rowCount
    }, {
      jobId: `webhook-recovery-${jobName}-${workspaceId.replaceAll('-', '')}-${bucket}`
    });

    await postgres.query(
      `UPDATE hubspot_webhook_events
       SET status = 'queued', error = NULL, processed_at = NOW(), updated_at = NOW()
       WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
      [workspaceId, result.rows.map((row) => row.id)]
    );

    await writeAudit(request, {
      workspaceId,
      actorUserId: request.customer.user.id,
      action: 'hubspot.webhooks_retried',
      targetType: 'webhook_batch',
      targetId: String(job.id),
      metadata: { count: result.rowCount, mode, retryAllFailed }
    });

    return reply.code(202).send({ status: 'queued', count: result.rowCount, mode, jobId: String(job.id) });
  });

  app.post('/api/v1/customer/workspaces/:workspaceId/webhooks/:eventId/ignore', { preHandler: requireAdmin }, async (request, reply) => {
    await schemaReady;
    const result = await postgres.query(
      `UPDATE hubspot_webhook_events
       SET status = 'ignored', error = NULL, processed_at = NOW(), updated_at = NOW()
       WHERE workspace_id = $1 AND id = $2 AND status IN ('failed', 'received')
       RETURNING id, subscription_type, object_type, object_id`,
      [request.params.workspaceId, request.params.eventId]
    );
    if (result.rowCount === 0) {
      return reply.code(404).send({ error: 'webhook_event_not_found', message: 'Retryable webhook event not found.' });
    }
    await writeAudit(request, {
      workspaceId: request.params.workspaceId,
      actorUserId: request.customer.user.id,
      action: 'hubspot.webhook_ignored',
      targetType: 'webhook_event',
      targetId: result.rows[0].id,
      metadata: {
        subscriptionType: result.rows[0].subscription_type,
        objectType: result.rows[0].object_type,
        objectId: result.rows[0].object_id
      }
    });
    return reply.code(204).send();
  });

  return { close: () => queue.close() };
}
