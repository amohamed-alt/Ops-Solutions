import { pathToFileURL } from 'node:url';

import { postgres } from './database.js';

const DEFAULT_WARNING_MINUTES = 90;
const DEFAULT_CRITICAL_MINUTES = 24 * 60;
const VALID_ACTIONS = new Set(['evaluate', 'status', 'acknowledge', 'resolve']);

export function normalizeMonitorOptions(input = {}) {
  const action = String(input.action ?? 'evaluate').trim().toLowerCase();
  if (!VALID_ACTIONS.has(action)) throw new TypeError('action must be evaluate, status, acknowledge, or resolve');
  const workspaceId = String(input.workspaceId ?? '').trim() || null;
  const warningMinutes = Number(input.warningMinutes ?? DEFAULT_WARNING_MINUTES);
  const criticalMinutes = Number(input.criticalMinutes ?? DEFAULT_CRITICAL_MINUTES);
  const incidentId = String(input.incidentId ?? '').trim() || null;
  const actor = String(input.actor ?? 'system').trim().slice(0, 160) || 'system';
  const note = String(input.note ?? '').trim().slice(0, 1000) || null;
  if (!Number.isInteger(warningMinutes) || warningMinutes < 15 || warningMinutes > 1440) throw new TypeError('warningMinutes must be an integer between 15 and 1440');
  if (!Number.isInteger(criticalMinutes) || criticalMinutes <= warningMinutes || criticalMinutes > 10080) throw new TypeError('criticalMinutes must be greater than warningMinutes and at most 10080');
  if (['acknowledge', 'resolve'].includes(action) && !incidentId) throw new TypeError('incidentId is required for acknowledge and resolve');
  return { action, workspaceId, warningMinutes, criticalMinutes, incidentId, actor, note };
}

export async function ensureDataSlaSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS data_sla_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      grade TEXT NOT NULL CHECK (grade IN ('healthy','warning','critical','unknown')),
      breaches JSONB NOT NULL DEFAULT '[]'::jsonb,
      metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
      policy JSONB NOT NULL DEFAULT '{}'::jsonb,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS data_sla_incidents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      fingerprint CHAR(64) NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('warning','critical')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
      breaches JSONB NOT NULL DEFAULT '[]'::jsonb,
      first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      acknowledged_at TIMESTAMPTZ,
      acknowledged_by TEXT,
      resolved_at TIMESTAMPTZ,
      resolved_by TEXT,
      note TEXT,
      occurrences INTEGER NOT NULL DEFAULT 1 CHECK (occurrences > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, fingerprint)
    );
    CREATE INDEX IF NOT EXISTS data_sla_snapshots_workspace_checked_idx
      ON data_sla_snapshots(workspace_id, checked_at DESC);
    CREATE INDEX IF NOT EXISTS data_sla_incidents_workspace_status_idx
      ON data_sla_incidents(workspace_id, status, last_detected_at DESC);
  `);
}

function ageMinutes(value, now) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, Math.floor((now.getTime() - timestamp) / 60000)) : null;
}

export function classifyDataSla(row, { now = new Date(), warningMinutes = DEFAULT_WARNING_MINUTES, criticalMinutes = DEFAULT_CRITICAL_MINUTES } = {}) {
  const breaches = [];
  const syncAgeMinutes = ageMinutes(row.newest_record_sync, now);
  if (row.connection_status !== 'connected') breaches.push('HubSpot disconnected');
  if (row.latest_sync_status === 'failed') breaches.push('Latest synchronization failed');
  if (Number(row.failed_webhooks_24h || 0) > 0) breaches.push(`${Number(row.failed_webhooks_24h)} failed webhook events in 24h`);
  if (Number(row.pending_mappings || 0) > 0) breaches.push(`${Number(row.pending_mappings)} mapping suggestions awaiting review`);
  if (syncAgeMinutes === null) breaches.push('No synchronized CRM freshness timestamp');
  else if (syncAgeMinutes > criticalMinutes) breaches.push(`CRM mirror exceeds critical freshness threshold (${syncAgeMinutes}m)`);
  else if (syncAgeMinutes > warningMinutes) breaches.push(`CRM mirror exceeds warning freshness threshold (${syncAgeMinutes}m)`);
  const critical = breaches.some((item) => /disconnected|failed|No synchronized|critical freshness/.test(item));
  return {
    grade: critical ? 'critical' : breaches.length ? 'warning' : 'healthy',
    breaches,
    metrics: {
      syncAgeMinutes,
      totalRecords: Number(row.total_records || 0),
      failedWebhooks24h: Number(row.failed_webhooks_24h || 0),
      pendingMappings: Number(row.pending_mappings || 0),
      latestSyncStatus: row.latest_sync_status ?? null,
      connectionStatus: row.connection_status ?? null
    }
  };
}

export function incidentFingerprint(breaches) {
  const normalized = [...new Set(breaches.map((item) => String(item).replace(/\d+/g, '#').trim()))].sort().join('|');
  return normalized;
}

async function loadWorkspaceHealth(db, workspaceId = null) {
  const values = [];
  const filter = workspaceId ? 'WHERE w.id = $1' : '';
  if (workspaceId) values.push(workspaceId);
  const result = await db.query(`
    WITH records AS (
      SELECT workspace_id, COUNT(*)::int AS total_records, MAX(synced_at) AS newest_record_sync
      FROM crm_records WHERE archived = FALSE GROUP BY workspace_id
    ), sync AS (
      SELECT DISTINCT ON (workspace_id) workspace_id, status AS latest_sync_status
      FROM sync_runs ORDER BY workspace_id, started_at DESC
    ), webhooks AS (
      SELECT workspace_id, COUNT(*) FILTER (WHERE status = 'failed' AND received_at >= NOW() - INTERVAL '24 hours')::int AS failed_webhooks_24h
      FROM hubspot_webhook_events GROUP BY workspace_id
    ), mappings AS (
      SELECT workspace_id, COUNT(*) FILTER (WHERE status = 'suggested')::int AS pending_mappings
      FROM property_mapping_suggestions GROUP BY workspace_id
    )
    SELECT w.id AS workspace_id, w.name AS workspace_name, c.portal_id, c.status AS connection_status,
           COALESCE(r.total_records, 0) AS total_records, r.newest_record_sync,
           s.latest_sync_status, COALESCE(h.failed_webhooks_24h, 0) AS failed_webhooks_24h,
           COALESCE(m.pending_mappings, 0) AS pending_mappings
    FROM workspaces w
    LEFT JOIN hubspot_connections c ON c.workspace_id = w.id
    LEFT JOIN records r ON r.workspace_id = w.id
    LEFT JOIN sync s ON s.workspace_id = w.id
    LEFT JOIN webhooks h ON h.workspace_id = w.id
    LEFT JOIN mappings m ON m.workspace_id = w.id
    ${filter}
    ORDER BY w.name
  `, values);
  return result.rows;
}

async function persistEvaluation(db, row, classification, policy) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO data_sla_snapshots(workspace_id, grade, breaches, metrics, policy)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)`,
      [row.workspace_id, classification.grade, JSON.stringify(classification.breaches), JSON.stringify(classification.metrics), JSON.stringify(policy)]
    );
    if (classification.grade === 'healthy') {
      await client.query(
        `UPDATE data_sla_incidents SET status = 'resolved', resolved_at = NOW(), resolved_by = 'system', updated_at = NOW()
         WHERE workspace_id = $1 AND status IN ('open','acknowledged')`,
        [row.workspace_id]
      );
    } else if (classification.grade !== 'unknown') {
      const crypto = await import('node:crypto');
      const fingerprint = crypto.createHash('sha256').update(incidentFingerprint(classification.breaches)).digest('hex');
      await client.query(
        `INSERT INTO data_sla_incidents(workspace_id, fingerprint, severity, breaches)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (workspace_id, fingerprint) DO UPDATE SET
           severity = EXCLUDED.severity, breaches = EXCLUDED.breaches,
           status = CASE WHEN data_sla_incidents.status = 'resolved' THEN 'open' ELSE data_sla_incidents.status END,
           resolved_at = NULL, resolved_by = NULL, last_detected_at = NOW(),
           occurrences = data_sla_incidents.occurrences + 1, updated_at = NOW()`,
        [row.workspace_id, fingerprint, classification.grade, JSON.stringify(classification.breaches)]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function evaluateDataSlas(db, options = {}) {
  const normalized = normalizeMonitorOptions({ ...options, action: 'evaluate' });
  await ensureDataSlaSchema(db);
  const rows = await loadWorkspaceHealth(db, normalized.workspaceId);
  const policy = { warningMinutes: normalized.warningMinutes, criticalMinutes: normalized.criticalMinutes };
  const results = [];
  for (const row of rows) {
    const classification = classifyDataSla(row, { ...policy, now: options.now ?? new Date() });
    await persistEvaluation(db, row, classification, policy);
    results.push({ workspaceId: row.workspace_id, workspaceName: row.workspace_name, portalId: row.portal_id ? Number(row.portal_id) : null, ...classification });
  }
  return { checkedAt: (options.now ?? new Date()).toISOString(), policy, results };
}

export async function listDataSlaStatus(db, { workspaceId = null, limit = 100 } = {}) {
  await ensureDataSlaSchema(db);
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const values = workspaceId ? [workspaceId, safeLimit] : [safeLimit];
  const filter = workspaceId ? 'WHERE i.workspace_id = $1' : '';
  const limitParameter = workspaceId ? '$2' : '$1';
  const result = await db.query(`
    SELECT i.id, i.workspace_id, w.name AS workspace_name, i.severity, i.status, i.breaches,
           i.first_detected_at, i.last_detected_at, i.acknowledged_at, i.acknowledged_by,
           i.resolved_at, i.resolved_by, i.note, i.occurrences
    FROM data_sla_incidents i JOIN workspaces w ON w.id = i.workspace_id
    ${filter} ORDER BY CASE i.status WHEN 'open' THEN 1 WHEN 'acknowledged' THEN 2 ELSE 3 END,
    i.last_detected_at DESC LIMIT ${limitParameter}
  `, values);
  return result.rows;
}

export async function transitionIncident(db, { incidentId, workspaceId = null, action, actor, note = null }) {
  const normalized = normalizeMonitorOptions({ incidentId, workspaceId, action, actor, note });
  await ensureDataSlaSchema(db);
  const status = action === 'acknowledge' ? 'acknowledged' : 'resolved';
  const actorColumn = action === 'acknowledge' ? 'acknowledged_by' : 'resolved_by';
  const timeColumn = action === 'acknowledge' ? 'acknowledged_at' : 'resolved_at';
  const values = [normalized.incidentId, normalized.actor, normalized.note];
  let workspaceFilter = '';
  if (normalized.workspaceId) { values.push(normalized.workspaceId); workspaceFilter = 'AND workspace_id = $4'; }
  const result = await db.query(
    `UPDATE data_sla_incidents SET status = '${status}', ${actorColumn} = $2, ${timeColumn} = NOW(),
       note = COALESCE($3, note), updated_at = NOW()
     WHERE id = $1 ${workspaceFilter} AND status <> 'resolved'
     RETURNING id, workspace_id, severity, status, breaches, occurrences, updated_at`,
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
  const options = normalizeMonitorOptions(parseArguments(process.argv.slice(2)));
  try {
    let result;
    if (options.action === 'evaluate') result = await evaluateDataSlas(postgres, options);
    else if (options.action === 'status') result = { incidents: await listDataSlaStatus(postgres, options) };
    else result = await transitionIncident(postgres, options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await postgres.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ error: 'data_sla_monitor_failed', message: error.message })}\n`);
    process.exitCode = 1;
  });
}
