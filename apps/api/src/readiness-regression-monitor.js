import { pathToFileURL } from 'node:url';

import { postgres } from './database.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_ACTIONS = new Set(['evaluate', 'status', 'acknowledge', 'resolve']);
const MIGRATION_LOCK = 812341291;
const DEFAULT_COOLDOWN_MINUTES = 360;
const DEFAULT_LIMIT = 200;

export function normalizeReadinessIncidentOptions(input = {}) {
  const action = String(input.action ?? 'evaluate').trim().toLowerCase();
  if (!VALID_ACTIONS.has(action)) throw new TypeError('action must be evaluate, status, acknowledge, or resolve');

  const workspaceId = String(input.workspaceId ?? '').trim() || null;
  const incidentId = String(input.incidentId ?? '').trim() || null;
  const actor = String(input.actor ?? 'system').trim().slice(0, 160) || 'system';
  const note = String(input.note ?? '').trim().slice(0, 1000) || null;
  const cooldownMinutes = Number(input.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES);
  const limit = Number(input.limit ?? DEFAULT_LIMIT);

  if (workspaceId && !UUID_PATTERN.test(workspaceId)) throw new TypeError('workspaceId must be a valid UUID');
  if (incidentId && !UUID_PATTERN.test(incidentId)) throw new TypeError('incidentId must be a valid UUID');
  if (!Number.isInteger(cooldownMinutes) || cooldownMinutes < 15 || cooldownMinutes > 10080) {
    throw new TypeError('cooldownMinutes must be an integer between 15 and 10080');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new TypeError('limit must be an integer between 1 and 1000');
  if (['acknowledge', 'resolve'].includes(action) && !incidentId) throw new TypeError('incidentId is required for acknowledge and resolve');

  return { action, workspaceId, incidentId, actor, note, cooldownMinutes, limit };
}

export async function ensureReadinessRegressionSchema(db) {
  const client = await db.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${MIGRATION_LOCK})`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS readiness_regression_incidents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
        severity TEXT NOT NULL DEFAULT 'critical' CHECK (severity IN ('warning','critical')),
        first_snapshot_id UUID NOT NULL REFERENCES onboarding_readiness_snapshots(id) ON DELETE RESTRICT,
        latest_snapshot_id UUID NOT NULL REFERENCES onboarding_readiness_snapshots(id) ON DELETE RESTRICT,
        first_detected_at TIMESTAMPTZ NOT NULL,
        last_detected_at TIMESTAMPTZ NOT NULL,
        last_notified_at TIMESTAMPTZ,
        acknowledged_at TIMESTAMPTZ,
        acknowledged_by TEXT,
        resolved_at TIMESTAMPTZ,
        resolved_by TEXT,
        note TEXT,
        occurrences INTEGER NOT NULL DEFAULT 1 CHECK (occurrences > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(workspace_id)
      );
      CREATE INDEX IF NOT EXISTS readiness_regression_incidents_status_updated_idx
        ON readiness_regression_incidents(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS readiness_regression_incidents_workspace_idx
        ON readiness_regression_incidents(workspace_id, last_detected_at DESC);
    `);
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${MIGRATION_LOCK})`).catch(() => undefined);
    client.release();
  }
}

async function loadLatestSnapshots(db, workspaceId = null, limit = DEFAULT_LIMIT) {
  const values = workspaceId ? [workspaceId, limit] : [limit];
  const filter = workspaceId ? 'WHERE w.id = $1' : '';
  const limitParameter = workspaceId ? '$2' : '$1';
  const result = await db.query(`
    SELECT w.id AS workspace_id, w.name AS workspace_name,
           s.id AS snapshot_id, s.ready, s.score, s.blockers, s.warnings,
           s.previous_ready, s.transitioned, s.generated_at, s.created_at
    FROM workspaces w
    JOIN LATERAL (
      SELECT id, ready, score, blockers, warnings, previous_ready, transitioned, generated_at, created_at
      FROM onboarding_readiness_snapshots
      WHERE workspace_id = w.id
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    ) s ON TRUE
    ${filter}
    ORDER BY s.created_at ASC
    LIMIT ${limitParameter}
  `, values);
  return result.rows;
}

export function classifyReadinessSnapshot(row) {
  if (!row) throw new TypeError('snapshot row is required');
  const ready = row.ready === true;
  const transitionedToBlocked = row.transitioned === true && row.previous_ready === true && !ready;
  return {
    ready,
    transitionedToBlocked,
    severity: Number(row.blockers || 0) > 0 ? 'critical' : 'warning',
    score: Number(row.score || 0),
    blockers: Number(row.blockers || 0),
    warnings: Number(row.warnings || 0)
  };
}

async function persistWorkspaceState(db, row, classification, cooldownMinutes) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`readiness-regression:${row.workspace_id}`]);

    if (classification.ready) {
      const resolved = await client.query(
        `UPDATE readiness_regression_incidents
         SET status='resolved', resolved_at=NOW(), resolved_by='system', updated_at=NOW(),
             latest_snapshot_id=$2, last_detected_at=$3
         WHERE workspace_id=$1 AND status IN ('open','acknowledged')
         RETURNING id, workspace_id, status, occurrences, resolved_at`,
        [row.workspace_id, row.snapshot_id, row.created_at]
      );
      await client.query('COMMIT');
      return { action: resolved.rowCount ? 'resolved' : 'healthy', incident: resolved.rows[0] ?? null, shouldNotify: false };
    }

    if (!classification.transitionedToBlocked) {
      const existing = await client.query(
        `SELECT id, status, occurrences, last_notified_at
         FROM readiness_regression_incidents WHERE workspace_id=$1`,
        [row.workspace_id]
      );
      await client.query('COMMIT');
      return { action: existing.rowCount ? 'unchanged' : 'blocked_without_regression', incident: existing.rows[0] ?? null, shouldNotify: false };
    }

    const upserted = await client.query(
      `INSERT INTO readiness_regression_incidents (
         workspace_id,status,severity,first_snapshot_id,latest_snapshot_id,
         first_detected_at,last_detected_at,occurrences
       ) VALUES ($1,'open',$2,$3,$3,$4,$4,1)
       ON CONFLICT (workspace_id) DO UPDATE SET
         status='open', severity=EXCLUDED.severity,
         latest_snapshot_id=EXCLUDED.latest_snapshot_id,
         last_detected_at=EXCLUDED.last_detected_at,
         resolved_at=NULL, resolved_by=NULL,
         occurrences=readiness_regression_incidents.occurrences + 1,
         updated_at=NOW()
       RETURNING id,workspace_id,status,severity,first_detected_at,last_detected_at,
                 last_notified_at,occurrences,created_at,updated_at`,
      [row.workspace_id, classification.severity, row.snapshot_id, row.created_at]
    );
    const incident = upserted.rows[0];
    const lastNotifiedAt = incident.last_notified_at ? new Date(incident.last_notified_at).getTime() : null;
    const shouldNotify = lastNotifiedAt === null || Date.now() - lastNotifiedAt >= cooldownMinutes * 60_000;

    await client.query('COMMIT');
    return { action: incident.occurrences === 1 ? 'opened' : 'reopened', incident, shouldNotify };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function evaluateReadinessRegressions(db, options = {}) {
  const normalized = normalizeReadinessIncidentOptions({ ...options, action: 'evaluate' });
  await ensureReadinessRegressionSchema(db);
  const snapshots = await loadLatestSnapshots(db, normalized.workspaceId, normalized.limit);
  const results = [];
  for (const row of snapshots) {
    const classification = classifyReadinessSnapshot(row);
    const persisted = await persistWorkspaceState(db, row, classification, normalized.cooldownMinutes);
    results.push({
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      snapshotId: row.snapshot_id,
      generatedAt: row.generated_at,
      ...classification,
      ...persisted
    });
  }
  return {
    checkedAt: new Date().toISOString(),
    policy: { cooldownMinutes: normalized.cooldownMinutes, limit: normalized.limit },
    summary: {
      evaluated: results.length,
      opened: results.filter((item) => item.action === 'opened').length,
      reopened: results.filter((item) => item.action === 'reopened').length,
      resolved: results.filter((item) => item.action === 'resolved').length,
      notificationCandidates: results.filter((item) => item.shouldNotify).length
    },
    results
  };
}

export async function listReadinessRegressionIncidents(db, options = {}) {
  const normalized = normalizeReadinessIncidentOptions({ ...options, action: 'status' });
  await ensureReadinessRegressionSchema(db);
  const values = normalized.workspaceId ? [normalized.workspaceId, normalized.limit] : [normalized.limit];
  const filter = normalized.workspaceId ? 'WHERE i.workspace_id=$1' : '';
  const limitParameter = normalized.workspaceId ? '$2' : '$1';
  const result = await db.query(`
    SELECT i.id,i.workspace_id,w.name AS workspace_name,i.status,i.severity,
           i.first_snapshot_id,i.latest_snapshot_id,i.first_detected_at,i.last_detected_at,
           i.last_notified_at,i.acknowledged_at,i.acknowledged_by,i.resolved_at,i.resolved_by,
           i.note,i.occurrences,i.created_at,i.updated_at,
           s.score,s.blockers,s.warnings,s.generated_at AS snapshot_generated_at
    FROM readiness_regression_incidents i
    JOIN workspaces w ON w.id=i.workspace_id
    JOIN onboarding_readiness_snapshots s ON s.id=i.latest_snapshot_id
    ${filter}
    ORDER BY CASE i.status WHEN 'open' THEN 1 WHEN 'acknowledged' THEN 2 ELSE 3 END,
             i.updated_at DESC
    LIMIT ${limitParameter}
  `, values);
  return result.rows;
}

export async function transitionReadinessRegressionIncident(db, options = {}) {
  const normalized = normalizeReadinessIncidentOptions(options);
  await ensureReadinessRegressionSchema(db);
  const targetStatus = normalized.action === 'acknowledge' ? 'acknowledged' : 'resolved';
  const actorColumn = normalized.action === 'acknowledge' ? 'acknowledged_by' : 'resolved_by';
  const timeColumn = normalized.action === 'acknowledge' ? 'acknowledged_at' : 'resolved_at';
  const values = [normalized.incidentId, normalized.actor, normalized.note];
  let workspaceFilter = '';
  if (normalized.workspaceId) {
    values.push(normalized.workspaceId);
    workspaceFilter = 'AND workspace_id=$4';
  }
  const result = await db.query(
    `UPDATE readiness_regression_incidents
     SET status='${targetStatus}', ${actorColumn}=$2, ${timeColumn}=NOW(),
         note=COALESCE($3,note), updated_at=NOW()
     WHERE id=$1 ${workspaceFilter} AND status<>'resolved'
     RETURNING id,workspace_id,status,severity,occurrences,updated_at`,
    values
  );
  if (!result.rowCount) throw new Error('Incident not found or already resolved');
  return result.rows[0];
}

function parseArguments(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    output[name] = argv[index + 1]?.startsWith('--') ? true : argv[++index];
  }
  return output;
}

async function main() {
  const options = normalizeReadinessIncidentOptions(parseArguments(process.argv.slice(2)));
  try {
    let result;
    if (options.action === 'evaluate') result = await evaluateReadinessRegressions(postgres, options);
    else if (options.action === 'status') result = { incidents: await listReadinessRegressionIncidents(postgres, options) };
    else result = await transitionReadinessRegressionIncident(postgres, options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await postgres.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ error: error.message })}\n`);
    process.exitCode = 4;
  });
}
