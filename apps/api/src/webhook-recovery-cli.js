import { Queue } from 'bullmq';

import { config } from './config.js';
import { postgres } from './database.js';
import { ensureHubSpotWebhookSchema, jobNameForMode } from './sync-operations.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['status', 'list', 'retry', 'ignore']);
const STATUSES = new Set(['received', 'queued', 'ignored', 'failed']);

export function parseWebhookRecoveryArguments(argv) {
  const input = Array.from(argv ?? []);
  const options = {
    action: 'status',
    workspaceId: '',
    status: '',
    limit: 50,
    eventIds: [],
    dryRun: false
  };

  for (let index = 0; index < input.length; index += 1) {
    const token = input[index];
    if (token === '--action') options.action = String(input[++index] ?? '').trim().toLowerCase();
    else if (token === '--workspace') options.workspaceId = String(input[++index] ?? '').trim();
    else if (token === '--status') options.status = String(input[++index] ?? '').trim().toLowerCase();
    else if (token === '--limit') options.limit = Number(input[++index]);
    else if (token === '--event') options.eventIds.push(String(input[++index] ?? '').trim());
    else if (token === '--dry-run') options.dryRun = true;
    else if (token === '--help' || token === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }

  if (options.help) return options;
  if (!ACTIONS.has(options.action)) throw new Error('Action must be status, list, retry, or ignore.');
  if (!UUID_PATTERN.test(options.workspaceId)) throw new Error('A valid --workspace UUID is required.');
  if (options.status && !STATUSES.has(options.status)) throw new Error('Status must be received, queued, ignored, or failed.');
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    throw new Error('--limit must be an integer between 1 and 100.');
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

function helpText() {
  return `HubSpot webhook recovery\n\nUsage:\n  node src/webhook-recovery-cli.js --action status --workspace <uuid>\n  node src/webhook-recovery-cli.js --action list --workspace <uuid> [--status failed] [--limit 50]\n  node src/webhook-recovery-cli.js --action retry --workspace <uuid> [--event <uuid>] [--limit 100] [--dry-run]\n  node src/webhook-recovery-cli.js --action ignore --workspace <uuid> --event <uuid> [--event <uuid>] [--dry-run]\n\nRetry without --event selects the oldest failed or received events from the last seven days.`;
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
