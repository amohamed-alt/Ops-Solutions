import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { Queue } from 'bullmq';

import { registerAnalyticsRoutes } from './analytics-runtime.js';
import { config } from './config.js';
import { registerReportExportRoutes } from './report-exports.js';
import { registerRevenueReportingRoutes } from './revenue-reporting.js';

const ALLOWED_MODES = new Set(['initial', 'incremental', 'full']);
const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60_000;
const WEBHOOK_MAX_EVENTS = 100;
const WEBHOOK_SCHEMA_ROLLBACK_SQL = 'DROP TABLE IF EXISTS hubspot_webhook_events;';
const OBJECT_TYPE_MAP = Object.freeze({
  contact: 'contacts',
  contacts: 'contacts',
  company: 'companies',
  companies: 'companies',
  deal: 'deals',
  deals: 'deals',
  call: 'calls',
  calls: 'calls',
  meeting: 'meetings',
  meetings: 'meetings',
  task: 'tasks',
  tasks: 'tasks'
});

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
  return mode === 'initial' ? 'initial-sync' : mode === 'full' ? 'full-sync' : 'incremental-sync';
}

function webhookError(message, statusCode = 400, category = 'INVALID_WEBHOOK') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.category = category;
  return error;
}

function decodeHubSpotSignatureUri(uri) {
  const replacements = {
    '%3A': ':', '%2F': '/', '%3F': '?', '%40': '@', '%21': '!', '%24': '$',
    '%27': "'", '%28': '(', '%29': ')', '%2A': '*', '%2C': ',', '%3B': ';'
  };
  return String(uri).replace(/%3A|%2F|%3F|%40|%21|%24|%27|%28|%29|%2A|%2C|%3B/gi, (match) => replacements[match.toUpperCase()]);
}

export function validateHubSpotV3Signature({
  clientSecret,
  method,
  uri,
  body,
  timestamp,
  signature,
  now = Date.now()
}) {
  const timestampNumber = Number(timestamp);
  if (!clientSecret || !signature || !Number.isFinite(timestampNumber)) return false;
  if (Math.abs(now - timestampNumber) > WEBHOOK_TIMESTAMP_TOLERANCE_MS) return false;

  const source = `${String(method).toUpperCase()}${decodeHubSpotSignatureUri(uri)}${body}${timestamp}`;
  const expected = createHmac('sha256', clientSecret).update(source, 'utf8').digest('base64');
  const actualBuffer = Buffer.from(String(signature));
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function normalizeHubSpotWebhookEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw webhookError('Webhook events must be JSON objects.');
  }

  const portalId = Number(value.portalId ?? value.portal_id);
  const objectId = String(value.objectId ?? value.object_id ?? '').trim();
  const subscriptionType = String(value.subscriptionType ?? value.subscription_type ?? value.eventType ?? '').trim();
  const occurredAtNumber = Number(value.occurredAt ?? value.occurred_at ?? Date.now());
  const eventId = String(value.eventId ?? value.event_id ?? '').trim();
  const objectPrefix = subscriptionType.split('.')[0].toLowerCase();
  const objectType = OBJECT_TYPE_MAP[objectPrefix] ?? null;

  if (!Number.isSafeInteger(portalId) || portalId <= 0 || !objectId || !subscriptionType) {
    throw webhookError('Each webhook event requires portalId, objectId, and subscriptionType.');
  }

  const action = /deletion|deleted|archive/i.test(subscriptionType)
    ? 'deleted'
    : /association/i.test(subscriptionType)
      ? 'association_changed'
      : /creation|created/i.test(subscriptionType)
        ? 'created'
        : 'changed';
  const occurredAt = Number.isFinite(occurredAtNumber)
    ? new Date(occurredAtNumber).toISOString()
    : new Date().toISOString();
  const eventKey = eventId || createHash('sha256').update(JSON.stringify({
    portalId,
    objectId,
    subscriptionType,
    occurredAt: occurredAtNumber,
    propertyName: value.propertyName ?? null,
    attemptNumber: value.attemptNumber ?? null
  })).digest('hex');

  return {
    eventKey,
    eventId: eventId || null,
    portalId,
    objectId,
    objectType,
    subscriptionType,
    action,
    occurredAt,
    propertyName: String(value.propertyName ?? '').trim() || null,
    attemptNumber: Number.isFinite(Number(value.attemptNumber)) ? Number(value.attemptNumber) : null,
    raw: value
  };
}

export async function ensureHubSpotWebhookSchema(postgres) {
  await postgres.query(`
    CREATE TABLE IF NOT EXISTS hubspot_webhook_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_key TEXT NOT NULL UNIQUE,
      workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
      portal_id BIGINT NOT NULL,
      event_id TEXT,
      subscription_type TEXT NOT NULL,
      object_type TEXT,
      object_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('created', 'changed', 'deleted', 'association_changed')),
      property_name TEXT,
      attempt_number INTEGER,
      occurred_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'queued', 'ignored', 'failed')),
      raw JSONB NOT NULL,
      error TEXT,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS hubspot_webhook_events_workspace_received_idx
      ON hubspot_webhook_events(workspace_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS hubspot_webhook_events_portal_received_idx
      ON hubspot_webhook_events(portal_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS hubspot_webhook_events_pending_idx
      ON hubspot_webhook_events(status, received_at)
      WHERE status IN ('received', 'failed');
  `);
}

export function getHubSpotWebhookRollbackSql() {
  return WEBHOOK_SCHEMA_ROLLBACK_SQL;
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

async function currentWebhookState(postgres, workspaceId) {
  const tableResult = await postgres.query("SELECT to_regclass('public.hubspot_webhook_events') AS table_name");
  if (!tableResult.rows[0]?.table_name) {
    return { initialized: false, received24h: 0, failed24h: 0, latestReceivedAt: null, latestStatus: null };
  }
  const result = await postgres.query(
    `SELECT COUNT(*) FILTER (WHERE received_at >= NOW() - INTERVAL '24 hours')::int AS received_24h,
            COUNT(*) FILTER (WHERE received_at >= NOW() - INTERVAL '24 hours' AND status = 'failed')::int AS failed_24h,
            MAX(received_at) AS latest_received_at,
            (ARRAY_AGG(status ORDER BY received_at DESC))[1] AS latest_status
     FROM hubspot_webhook_events
     WHERE workspace_id = $1`,
    [workspaceId]
  );
  const row = result.rows[0] ?? {};
  return {
    initialized: true,
    received24h: Number(row.received_24h ?? 0),
    failed24h: Number(row.failed_24h ?? 0),
    latestReceivedAt: row.latest_received_at ?? null,
    latestStatus: row.latest_status ?? null
  };
}

async function currentSyncState(postgres, workspaceId) {
  if (!await syncSchemaReady(postgres)) {
    return {
      initialized: false,
      activeRun: null,
      latestRun: null,
      cursors: [],
      recordCounts: [],
      freshness: null,
      webhooks: await currentWebhookState(postgres, workspaceId)
    };
  }

  const [activeResult, latestResult, cursorsResult, countsResult, freshnessResult, webhooks] = await Promise.all([
    postgres.query(
      `SELECT id, mode, status, object_types, summary, error, started_at, completed_at
       FROM sync_runs WHERE workspace_id = $1 AND status = 'running'
       ORDER BY started_at DESC LIMIT 1`,
      [workspaceId]
    ),
    postgres.query(
      `SELECT id, mode, status, object_types, summary, error, started_at, completed_at
       FROM sync_runs WHERE workspace_id = $1 ORDER BY started_at DESC LIMIT 1`,
      [workspaceId]
    ),
    postgres.query(
      `SELECT object_type, last_modified_at, last_success_at,
              last_full_sync_at, last_incremental_sync_at, updated_at
       FROM sync_cursors WHERE workspace_id = $1 ORDER BY object_type`,
      [workspaceId]
    ),
    postgres.query(
      `SELECT object_type, COUNT(*)::int AS count,
              COUNT(*) FILTER (WHERE archived = TRUE)::int AS archived_count
       FROM crm_records WHERE workspace_id = $1 GROUP BY object_type ORDER BY object_type`,
      [workspaceId]
    ),
    postgres.query(
      `SELECT MAX(synced_at) AS newest_record_sync,
              MIN(synced_at) AS oldest_record_sync,
              COUNT(*)::bigint AS total_records
       FROM crm_records WHERE workspace_id = $1`,
      [workspaceId]
    ),
    currentWebhookState(postgres, workspaceId)
  ]);

  return {
    initialized: true,
    activeRun: activeResult.rows[0] ?? null,
    latestRun: latestResult.rows[0] ?? null,
    cursors: cursorsResult.rows,
    recordCounts: countsResult.rows,
    freshness: freshnessResult.rows[0] ?? null,
    webhooks
  };
}

async function queueWebhookSyncs({ postgres, queue, events }) {
  const portalIds = [...new Set(events.map((event) => event.portalId))];
  const connectionResult = await postgres.query(
    `SELECT workspace_id, portal_id
     FROM hubspot_connections
     WHERE portal_id = ANY($1::bigint[]) AND status = 'connected'`,
    [portalIds]
  );
  const workspaceByPortal = new Map(connectionResult.rows.map((row) => [Number(row.portal_id), String(row.workspace_id)]));
  const requestedModeByWorkspace = new Map();
  let accepted = 0;
  let duplicates = 0;
  let ignored = 0;

  for (const event of events) {
    const workspaceId = workspaceByPortal.get(event.portalId) ?? null;
    const insertResult = await postgres.query(
      `INSERT INTO hubspot_webhook_events (
         event_key, workspace_id, portal_id, event_id, subscription_type,
         object_type, object_id, action, property_name, attempt_number,
         occurred_at, status, raw
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
       ON CONFLICT (event_key) DO NOTHING
       RETURNING id`,
      [
        event.eventKey,
        workspaceId,
        event.portalId,
        event.eventId,
        event.subscriptionType,
        event.objectType,
        event.objectId,
        event.action,
        event.propertyName,
        event.attemptNumber,
        event.occurredAt,
        workspaceId ? 'received' : 'ignored',
        JSON.stringify(event.raw)
      ]
    );
    if (insertResult.rowCount === 0) {
      duplicates += 1;
      continue;
    }
    if (!workspaceId || !event.objectType) {
      ignored += 1;
      continue;
    }

    if (event.action === 'deleted') {
      await postgres.query(
        `UPDATE crm_records
         SET archived = TRUE, synced_at = NOW(), raw = raw || $4::jsonb
         WHERE workspace_id = $1 AND object_type = $2 AND record_id = $3`,
        [workspaceId, event.objectType, event.objectId, JSON.stringify({ webhookDeletedAt: event.occurredAt })]
      );
      await postgres.query(
        `DELETE FROM crm_record_associations
         WHERE workspace_id = $1
           AND ((from_object_type = $2 AND from_record_id = $3)
             OR (to_object_type = $2 AND to_record_id = $3))`,
        [workspaceId, event.objectType, event.objectId]
      );
    }

    const requestedMode = event.action === 'association_changed' ? 'full' : 'incremental';
    if (requestedMode === 'full' || !requestedModeByWorkspace.has(workspaceId)) {
      requestedModeByWorkspace.set(workspaceId, requestedMode);
    }
    accepted += 1;
  }

  const bucket = Math.floor(Date.now() / 30_000);
  for (const [workspaceId, mode] of requestedModeByWorkspace) {
    const jobName = jobNameForMode(mode);
    await queue.add(jobName, {
      workspaceId,
      requestedAt: new Date().toISOString(),
      source: 'hubspot_webhook',
      eventCount: events.filter((event) => workspaceByPortal.get(event.portalId) === workspaceId).length
    }, {
      jobId: `webhook-${jobName}-${workspaceId.replaceAll('-', '')}-${bucket}`
    });
    await postgres.query(
      `UPDATE hubspot_webhook_events
       SET status = 'queued', processed_at = NOW(), updated_at = NOW()
       WHERE workspace_id = $1 AND status = 'received'`,
      [workspaceId]
    );
  }

  return { accepted, duplicates, ignored, queuedWorkspaces: requestedModeByWorkspace.size };
}

export function registerSyncOperationsRoutes(app, { postgres, redisUrl, requireAdmin, requireWorkspace }) {
  const queue = new Queue('hubspot-sync', {
    connection: { url: redisUrl, maxRetriesPerRequest: 3, enableReadyCheck: true },
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: 86_400, count: 1000 },
      removeOnFail: { age: 604_800, count: 1000 }
    }
  });
  const webhookSchemaReady = ensureHubSpotWebhookSchema(postgres);

  app.post('/api/v1/hubspot/webhooks', async (request, reply) => {
    await webhookSchemaReady;
    if (!config.hubspot.clientSecret) {
      return reply.code(503).send({ error: 'webhook_not_configured', message: 'HubSpot webhook validation is not configured.' });
    }

    const body = JSON.stringify(request.body ?? null);
    const signature = String(request.headers['x-hubspot-signature-v3'] ?? '');
    const timestamp = String(request.headers['x-hubspot-request-timestamp'] ?? '');
    const uri = new URL(request.raw.url, config.appUrl).toString();
    const valid = validateHubSpotV3Signature({
      clientSecret: config.hubspot.clientSecret,
      method: request.method,
      uri,
      body,
      timestamp,
      signature
    });
    if (!valid) {
      return reply.code(401).send({ error: 'invalid_hubspot_signature', message: 'Webhook signature validation failed.' });
    }

    const payload = request.body;
    if (!Array.isArray(payload) || payload.length === 0 || payload.length > WEBHOOK_MAX_EVENTS) {
      return reply.code(400).send({
        error: 'invalid_webhook_batch',
        message: `Webhook body must contain between 1 and ${WEBHOOK_MAX_EVENTS} events.`
      });
    }

    const events = payload.map(normalizeHubSpotWebhookEvent);
    try {
      const result = await queueWebhookSyncs({ postgres, queue, events });
      request.log.info({ ...result, portals: [...new Set(events.map((event) => event.portalId))] }, 'HubSpot webhook batch accepted');
      return reply.code(204).send();
    } catch (error) {
      request.log.error({ error, eventCount: events.length }, 'HubSpot webhook processing failed');
      throw error;
    }
  });

  app.get('/api/v1/workspaces/:workspaceId/sync', { preHandler: requireAdmin }, async (request) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    await webhookSchemaReady;
    return { workspace, ...(await currentSyncState(postgres, workspace.id)) };
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
        `SELECT id, mode, started_at FROM sync_runs
         WHERE workspace_id = $1 AND status = 'running'
         ORDER BY started_at DESC LIMIT 1`,
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

    return reply.code(202).send({ status: 'queued', workspaceId: workspace.id, mode, jobName, jobId: String(job.id) });
  });

  registerAnalyticsRoutes(app, { postgres, requireAdmin, requireWorkspace });
  registerRevenueReportingRoutes(app, { postgres, requireAdmin, requireWorkspace });
  registerReportExportRoutes(app, { postgres, requireAdmin, requireWorkspace });

  return { close: () => queue.close() };
}
