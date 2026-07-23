import { Queue } from 'bullmq';

import { config } from './config.js';
import { postgres } from './database.js';
import { ensureHubSpotWebhookSchema, jobNameForMode } from './sync-operations.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['fleet', 'status', 'list', 'retry', 'ignore']);
const STATUSES = new Set(['received', 'queued', 'ignored', 'failed']);

export function parseWebhookRecoveryArguments(argv) {
  const input = Array.from(argv ?? []);
  const options = {
    action: 'status',
    workspaceId: '',
    status: '',
    limit: 50,
    eventIds: [],
    dryRun: false,
    staleHours: 24,
    onlyUnhealthy: false
  };

  for (let index = 0; index < input.length; index += 1) {
    const token = input[index];
    if (token === '--action') options.action = String(input[++index] ?? '').trim().toLowerCase();
    else if (token === '--workspace') options.workspaceId = String(input[++index] ?? '').trim();
    else if (token === '--status') options.status = String(input[++index] ?? '').trim().toLowerCase();
    else if (token === '--limit') options.limit = Number(input[++index]);
    else if (token === '--event') options.eventIds.push(String(input[++index] ?? '').trim());
    else if (token === '--stale-hours') options.staleHours = Number(input[++index]);
    else if (token === '--only-unhealthy') options.onlyUnhealthy = true;
    else if (token === '--dry-run') options.dryRun = true;
    else if (token === '--help' || token === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }

  if (options.help) return options;
  if (!ACTIONS.has(options.action)) throw new Error('Action must be fleet, status, list, retry, or ignore.');
  if (options.action !== 'fleet' && !UUID_PATTERN.test(options.workspaceId)) {
    throw new Error('A valid --workspace UUID is required.');
  }
  if (options.action === 'fleet' && options.workspaceId) {
    throw new Error('Fleet health does not accept --workspace. Use status for one workspace.');
  }
  if (options.status && !STATUSES.has(options.status)) throw new Error('Status must be received, queued, ignored, or failed.');
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    throw new Error('--limit must be an integer between 1 and 100.');
  }
  if (!Number.isFinite(options.staleHours) || options.staleHours < 1 || options.staleHours > 720) {
    throw new Error('--stale-hours must be between 1 and 720.');
  }
  options.eventIds = [...new Set(options.eventIds.filter(Boolean))];
  if (options.action === 'ignore' && options.eventIds.length === 0) {
    throw new Error('Ignore requires at least one --event UUID.');
  }
  return options;
}

export function recoveryModeForEvents(events) {
  return events.some((event) => event.action === 'association_changed' || event.action === 'deleted')
    ? 'full'
    : 'incremental';
}

export function classifyFleetWorkspace(row, { now = Date.now(), staleHours = 24 } = {}) {
  const connectionStatus = String(row.hubspot_status ?? 'disconnected');
  const failed = Number(row.failed ?? 0);
  const pending = Number(row.pending ?? 0);
  const latestReceivedAt = row.latest_received_at ? new Date(row.latest_received_at).getTime() : null;
  const latestSyncAt = row.latest_sync_at ? new Date(row.latest_sync_at).getTime() : null;
  const staleAfterMs = staleHours * 60 * 60 * 1000;

  let health = 'healthy';
  let reason = 'Connection, webhook journal and synchronization are healthy.';
  if (connectionStatus !== 'connected') {
    health = 'disconnected';
    reason = 'HubSpot OAuth is not connected.';
  } else if (failed > 0) {
    health = 'degraded';
    reason = `${failed} webhook event${failed === 1 ? '' : 's'} require recovery.`;
  } else if (pending > 0) {
    health = 'pending';
    reason = `${pending} webhook event${pending === 1 ? '' : 's'} are waiting to be queued.`;
  } else if (latestSyncAt && now - latestSyncAt > staleAfterMs) {
    health = 'stale';
    reason = `The CRM mirror has not synchronized within ${staleHours} hours.`;
  } else if (!latestReceivedAt) {
    health = 'no_webhooks';
    reason = 'No webhook delivery has been observed for this workspace.';
  }

  return {
    workspaceId: String(row.workspace_id),
    workspaceName: String(row.workspace_name),
    portalId: row.portal_id ? Number(row.portal_id) : null,
    connectionStatus,
    health,
    reason,
    counts: {
      total: Number(row.total ?? 0),
      failed,
      pending,
      queued: Number(row.queued ?? 0),
      ignored: Number(row.ignored ?? 0)
    },
    latestReceivedAt: row.latest_received_at ?? null,
    latestProcessedAt: row.latest_processed_at ?? null,
    latestSyncAt: row.latest_sync_at ?? null
  };
}

function helpText() {
  return `HubSpot webhook recovery\n\nUsage:\n  node src/webhook-recovery-cli.js --action fleet [--only-unhealthy] [--stale-hours 24]\n  node src/webhook-recovery-cli.js --action status --workspace <uuid>\n  node src/webhook-recovery-cli.js --action list --workspace <uuid> [--status failed] [--limit 50]\n  node src/webhook-recovery-cli.js --action retry --workspace <uuid> [--event <uuid>] [--limit 100] [--dry-run]\n  node src/webhook-recovery-cli.js --action ignore --workspace <uuid> --event <uuid> [--event <uuid>] [--dry-run]\n\nFleet health is read-only. Retry without --event selects the oldest failed or received events from the last seven days.`;
}

async function requireWorkspace(workspaceId) {
  const result = await postgres.query(
    `SELECT w.id, w.name, c.status AS hubspot_status
     FROM workspaces w
     LEFT JOIN hubspot_connections c ON c.workspace_id = w.id
     WHERE w.id = $1
     LIMIT 1`,
    [workspaceId]
  );
  if (result.rowCount === 0) throw new Error('Workspace not found.');
  return result.rows[0];
}

async function fleetHealth({ staleHours, onlyUnhealthy }) {
  const result = await postgres.query(
    `SELECT w.id AS workspace_id,
            w.name AS workspace_name,
            c.portal_id,
            c.status AS hubspot_status,
            COUNT(e.id)::int AS total,
            COUNT(e.id) FILTER (WHERE e.status = 'failed')::int AS failed,
            COUNT(e.id) FILTER (WHERE e.status = 'received')::int AS pending,
            COUNT(e.id) FILTER (WHERE e.status = 'queued')::int AS queued,
            COUNT(e.id) FILTER (WHERE e.status = 'ignored')::int AS ignored,
            MAX(e.received_at) AS latest_received_at,
            MAX(e.processed_at) AS latest_processed_at,
            MAX(r.synced_at) AS latest_sync_at
     FROM workspaces w
     LEFT JOIN hubspot_connections c ON c.workspace_id = w.id
     LEFT JOIN hubspot_webhook_events e ON e.workspace_id = w.id
     LEFT JOIN crm_records r ON r.workspace_id = w.id
     WHERE w.status = 'active'
     GROUP BY w.id, w.name, c.portal_id, c.status
     ORDER BY w.name`,
    []
  );
  const workspaces = result.rows.map((row) => classifyFleetWorkspace(row, { staleHours }));
  const visible = onlyUnhealthy ? workspaces.filter((workspace) => workspace.health !== 'healthy') : workspaces;
  const summary = visible.reduce((output, workspace) => {
    output.total += 1;
    output[workspace.health] = Number(output[workspace.health] ?? 0) + 1;
    output.failedEvents += workspace.counts.failed;
    output.pendingEvents += workspace.counts.pending;
    return output;
  }, { total: 0, failedEvents: 0, pendingEvents: 0 });
  return { generatedAt: new Date().toISOString(), staleHours, summary, workspaces: visible };
}

async function status(workspaceId) {
  const result = await postgres.query(
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
  );
  return result.rows[0];
}

async function listEvents({ workspaceId, status: selectedStatus, limit }) {
  const values = [workspaceId, limit];
  const filter = selectedStatus ? `AND status = $3` : '';
  if (selectedStatus) values.push(selectedStatus);
  const result = await postgres.query(
    `SELECT id, subscription_type, object_type, object_id, action, property_name,
            attempt_number, status, error, occurred_at, received_at, processed_at
     FROM hubspot_webhook_events
     WHERE workspace_id = $1 ${filter}
     ORDER BY received_at DESC
     LIMIT $2`,
    values
  );
  return result.rows;
}

async function selectRetryableEvents({ workspaceId, eventIds, limit }) {
  if (eventIds.length > 0) {
    return (await postgres.query(
      `SELECT id, action, object_type, object_id, status
       FROM hubspot_webhook_events
       WHERE workspace_id = $1 AND id = ANY($2::uuid[])
         AND status IN ('failed', 'received')
       ORDER BY received_at ASC`,
      [workspaceId, eventIds]
    )).rows;
  }
  return (await postgres.query(
    `SELECT id, action, object_type, object_id, status
     FROM hubspot_webhook_events
     WHERE workspace_id = $1 AND status IN ('failed', 'received')
       AND received_at >= NOW() - INTERVAL '7 days'
     ORDER BY received_at ASC
     LIMIT $2`,
    [workspaceId, limit]
  )).rows;
}

async function retryEvents(options, workspace) {
  const events = await selectRetryableEvents(options);
  if (events.length === 0) return { status: 'nothing_to_retry', count: 0 };
  const mode = recoveryModeForEvents(events);
  if (options.dryRun) return { status: 'dry_run', count: events.length, mode, events };
  if (workspace.hubspot_status !== 'connected') throw new Error('Workspace HubSpot connection is not connected.');

  const queue = new Queue('hubspot-sync', {
    connection: { url: config.redisUrl, maxRetriesPerRequest: 3, enableReadyCheck: true },
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: 86_400, count: 1000 },
      removeOnFail: { age: 604_800, count: 1000 }
    }
  });
  try {
    const jobName = jobNameForMode(mode);
    const job = await queue.add(jobName, {
      workspaceId: options.workspaceId,
      requestedAt: new Date().toISOString(),
      requestedBy: 'webhook_recovery_cli',
      source: 'webhook_recovery_cli',
      webhookEventIds: events.map((event) => event.id),
      eventCount: events.length
    }, {
      jobId: `webhook-recovery-${jobName}-${options.workspaceId.replaceAll('-', '')}-${Date.now()}`
    });
    await postgres.query(
      `UPDATE hubspot_webhook_events
       SET status = 'queued', error = NULL, processed_at = NOW(), updated_at = NOW()
       WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
      [options.workspaceId, events.map((event) => event.id)]
    );
    return { status: 'queued', count: events.length, mode, jobId: String(job.id) };
  } finally {
    await queue.close();
  }
}

async function ignoreEvents(options) {
  if (options.dryRun) {
    const rows = await listEvents({ workspaceId: options.workspaceId, status: '', limit: 100 });
    return { status: 'dry_run', events: rows.filter((row) => options.eventIds.includes(row.id)) };
  }
  const result = await postgres.query(
    `UPDATE hubspot_webhook_events
     SET status = 'ignored', error = NULL, processed_at = NOW(), updated_at = NOW()
     WHERE workspace_id = $1 AND id = ANY($2::uuid[])
       AND status IN ('failed', 'received')
     RETURNING id, subscription_type, object_type, object_id`,
    [options.workspaceId, options.eventIds]
  );
  return { status: 'ignored', count: result.rowCount, events: result.rows };
}

export async function runWebhookRecovery(options) {
  await ensureHubSpotWebhookSchema(postgres);
  if (options.action === 'fleet') return fleetHealth(options);
  const workspace = await requireWorkspace(options.workspaceId);
  if (options.action === 'status') return { workspace, summary: await status(options.workspaceId) };
  if (options.action === 'list') return { workspace, events: await listEvents(options) };
  if (options.action === 'retry') return { workspace, result: await retryEvents(options, workspace) };
  return { workspace, result: await ignoreEvents(options) };
}

async function main() {
  const options = parseWebhookRecoveryArguments(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }
  const result = await runWebhookRecovery(options);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main()
    .catch((error) => {
      console.error(JSON.stringify({ error: error.message }, null, 2));
      process.exitCode = 1;
    })
    .finally(() => postgres.end());
}
