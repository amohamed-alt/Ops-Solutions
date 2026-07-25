import { pathToFileURL } from 'node:url';

import { postgres } from './database.js';

const MAX_ATTEMPTS = 5;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeText(value, max = 1000) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

export function normalizeDeadLetterOptions(input = {}) {
  const action = String(input.action || 'status').trim().toLowerCase();
  const limit = Number(input.limit ?? DEFAULT_LIMIT);
  const workspaceId = input.workspaceId ? String(input.workspaceId).trim() : null;
  const deliveryId = input.deliveryId ? String(input.deliveryId).trim() : null;
  const apply = input.apply === true || input.apply === 'true';

  if (!['status', 'requeue'].includes(action)) {
    throw new TypeError('action must be status or requeue');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new TypeError(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  if (workspaceId && !UUID_PATTERN.test(workspaceId)) {
    throw new TypeError('workspaceId must be a valid UUID');
  }
  if (deliveryId && !UUID_PATTERN.test(deliveryId)) {
    throw new TypeError('deliveryId must be a valid UUID');
  }
  if (action === 'requeue' && !workspaceId) {
    throw new TypeError('workspaceId is required for requeue');
  }
  if (action === 'requeue' && !deliveryId) {
    throw new TypeError('deliveryId is required for requeue');
  }

  return { action, limit, workspaceId, deliveryId, apply };
}

export async function getReadinessDeliveryDeadLetterStatus(db, options = {}) {
  const normalized = normalizeDeadLetterOptions({ ...options, action: 'status' });
  const parameters = [];
  const workspaceFilter = normalized.workspaceId
    ? `AND d.workspace_id=$${parameters.push(normalized.workspaceId)}`
    : '';
  parameters.push(normalized.limit);

  const result = await db.query(`
    SELECT d.id,
           d.workspace_id,
           d.incident_id,
           d.snapshot_id,
           d.kind,
           d.status,
           d.attempts,
           d.next_attempt_at,
           d.created_at,
           d.updated_at,
           left(coalesce(d.error,''), 240) AS error,
           w.name AS workspace_name
    FROM readiness_regression_deliveries d
    JOIN workspaces w ON w.id=d.workspace_id
    WHERE d.status='failed'
      AND d.attempts >= ${MAX_ATTEMPTS}
      ${workspaceFilter}
    ORDER BY d.updated_at DESC,d.created_at DESC
    LIMIT $${parameters.length}
  `, parameters);

  const countParameters = [];
  const countWorkspaceFilter = normalized.workspaceId
    ? `AND workspace_id=$${countParameters.push(normalized.workspaceId)}`
    : '';
  const totals = await db.query(`
    SELECT count(*)::integer AS total,
           count(*) FILTER (WHERE kind='regression')::integer AS regression,
           count(*) FILTER (WHERE kind='recovery')::integer AS recovery,
           min(updated_at) AS oldest_updated_at,
           max(updated_at) AS newest_updated_at
    FROM readiness_regression_deliveries
    WHERE status='failed'
      AND attempts >= ${MAX_ATTEMPTS}
      ${countWorkspaceFilter}
  `, countParameters);

  return {
    scope: normalized.workspaceId ? 'workspace' : 'fleet',
    workspaceId: normalized.workspaceId,
    maxAttempts: MAX_ATTEMPTS,
    summary: totals.rows[0] || { total: 0, regression: 0, recovery: 0 },
    deliveries: result.rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      workspaceName: safeText(row.workspace_name, 120),
      incidentId: row.incident_id,
      snapshotId: row.snapshot_id,
      kind: row.kind,
      attempts: Number(row.attempts || 0),
      error: safeText(row.error, 240),
      nextAttemptAt: row.next_attempt_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  };
}

export async function requeueReadinessDelivery(db, options = {}) {
  const normalized = normalizeDeadLetterOptions({ ...options, action: 'requeue' });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(`
      SELECT id,workspace_id,status,attempts,kind
      FROM readiness_regression_deliveries
      WHERE id=$1 AND workspace_id=$2
      FOR UPDATE
    `, [normalized.deliveryId, normalized.workspaceId]);

    if (!locked.rowCount) {
      await client.query('ROLLBACK');
      return { found: false, requeued: false, dryRun: !normalized.apply };
    }

    const delivery = locked.rows[0];
    const eligible = delivery.status === 'failed' && Number(delivery.attempts) >= MAX_ATTEMPTS;
    if (!eligible) {
      await client.query('ROLLBACK');
      return {
        found: true,
        eligible: false,
        requeued: false,
        dryRun: !normalized.apply,
        status: delivery.status,
        attempts: Number(delivery.attempts || 0)
      };
    }

    if (!normalized.apply) {
      await client.query('ROLLBACK');
      return {
        found: true,
        eligible: true,
        requeued: false,
        dryRun: true,
        kind: delivery.kind,
        attempts: Number(delivery.attempts || 0)
      };
    }

    const updated = await client.query(`
      UPDATE readiness_regression_deliveries
      SET status='pending',
          attempts=0,
          next_attempt_at=NOW(),
          claimed_at=NULL,
          provider=NULL,
          provider_message_id=NULL,
          error='manually_requeued_after_dead_letter_review',
          updated_at=NOW()
      WHERE id=$1
        AND workspace_id=$2
        AND status='failed'
        AND attempts >= ${MAX_ATTEMPTS}
      RETURNING id,workspace_id,kind,status,attempts,next_attempt_at
    `, [normalized.deliveryId, normalized.workspaceId]);
    await client.query('COMMIT');

    return {
      found: true,
      eligible: true,
      requeued: updated.rowCount === 1,
      dryRun: false,
      delivery: updated.rows[0] || null
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function runReadinessDeliveryDeadLetterOperation(db, options = {}) {
  const normalized = normalizeDeadLetterOptions(options);
  if (normalized.action === 'requeue') {
    return requeueReadinessDelivery(db, normalized);
  }
  return getReadinessDeliveryDeadLetterStatus(db, normalized);
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const options = {
    action: argumentValue('--action') || 'status',
    limit: argumentValue('--limit'),
    workspaceId: argumentValue('--workspace'),
    deliveryId: argumentValue('--delivery'),
    apply: process.argv.includes('--apply')
  };
  try {
    const result = await runReadinessDeliveryDeadLetterOperation(postgres, options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await postgres.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ error: safeText(error.message, 1000) })}\n`);
    process.exitCode = 4;
  });
}
