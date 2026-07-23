const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function normalizeTenantAuditOptions(input = {}) {
  return {
    workspaceId: input.workspaceId ? String(input.workspaceId).trim() : null,
    limit: boundedInteger(input.limit, DEFAULT_LIMIT, 1, MAX_LIMIT),
    staleHours: boundedInteger(input.staleHours, 24, 1, 720)
  };
}

const CHECKS = Object.freeze([
  {
    key: 'duplicate_portal_connections',
    severity: 'critical',
    description: 'A HubSpot portal must belong to only one workspace.',
    sql: `
      SELECT portal_id::text AS entity_id, COUNT(*)::int AS occurrences,
             ARRAY_AGG(workspace_id::text ORDER BY workspace_id::text) AS workspace_ids
      FROM hubspot_connections
      WHERE portal_id IS NOT NULL
        AND ($1::uuid IS NULL OR workspace_id = $1)
      GROUP BY portal_id
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC, portal_id
      LIMIT $2
    `
  },
  {
    key: 'orphaned_memberships',
    severity: 'critical',
    description: 'Workspace memberships must reference an existing user and workspace.',
    sql: `
      SELECT CONCAT(m.user_id::text, ':', m.workspace_id::text) AS entity_id,
             m.workspace_id::text AS workspace_id
      FROM workspace_memberships m
      LEFT JOIN app_users u ON u.id = m.user_id
      LEFT JOIN workspaces w ON w.id = m.workspace_id
      WHERE (u.id IS NULL OR w.id IS NULL)
        AND ($1::uuid IS NULL OR m.workspace_id = $1)
      ORDER BY m.workspace_id, m.user_id
      LIMIT $2
    `
  },
  {
    key: 'workspaces_without_owner',
    severity: 'critical',
    description: 'Every active workspace must retain at least one owner.',
    sql: `
      SELECT w.id::text AS entity_id, w.id::text AS workspace_id
      FROM workspaces w
      LEFT JOIN workspace_memberships m
        ON m.workspace_id = w.id AND m.role = 'owner'
      WHERE w.status = 'active'
        AND ($1::uuid IS NULL OR w.id = $1)
      GROUP BY w.id
      HAVING COUNT(m.user_id) = 0
      ORDER BY w.id
      LIMIT $2
    `
  },
  {
    key: 'orphaned_crm_records',
    severity: 'critical',
    description: 'Mirrored CRM records must belong to an existing workspace.',
    sql: `
      SELECT CONCAT(r.object_type, ':', r.record_id) AS entity_id,
             r.workspace_id::text AS workspace_id
      FROM crm_records r
      LEFT JOIN workspaces w ON w.id = r.workspace_id
      WHERE w.id IS NULL
        AND ($1::uuid IS NULL OR r.workspace_id = $1)
      ORDER BY r.workspace_id, r.object_type, r.record_id
      LIMIT $2
    `
  },
  {
    key: 'orphaned_associations',
    severity: 'warning',
    description: 'CRM associations must have a corresponding source record in the same workspace.',
    sql: `
      SELECT CONCAT(a.from_object_type, ':', a.from_record_id, '->', a.to_object_type, ':', a.to_record_id) AS entity_id,
             a.workspace_id::text AS workspace_id
      FROM crm_record_associations a
      LEFT JOIN crm_records source
        ON source.workspace_id = a.workspace_id
       AND source.object_type = a.from_object_type
       AND source.record_id = a.from_record_id
      WHERE source.record_id IS NULL
        AND ($1::uuid IS NULL OR a.workspace_id = $1)
      ORDER BY a.workspace_id, a.from_object_type, a.from_record_id
      LIMIT $2
    `
  },
  {
    key: 'stale_processing_webhooks',
    severity: 'warning',
    description: 'Webhook events should not remain processing beyond the configured threshold.',
    sql: `
      SELECT e.id::text AS entity_id, e.workspace_id::text AS workspace_id,
             e.received_at, e.updated_at
      FROM hubspot_webhook_events e
      WHERE e.status = 'processing'
        AND e.updated_at < NOW() - ($3::int * INTERVAL '1 hour')
        AND ($1::uuid IS NULL OR e.workspace_id = $1)
      ORDER BY e.updated_at
      LIMIT $2
    `
  },
  {
    key: 'stale_running_syncs',
    severity: 'warning',
    description: 'Sync runs should not remain running beyond the configured threshold.',
    sql: `
      SELECT s.id::text AS entity_id, s.workspace_id::text AS workspace_id,
             s.mode, s.started_at
      FROM sync_runs s
      WHERE s.status = 'running'
        AND s.started_at < NOW() - ($3::int * INTERVAL '1 hour')
        AND ($1::uuid IS NULL OR s.workspace_id = $1)
      ORDER BY s.started_at
      LIMIT $2
    `
  },
  {
    key: 'mapping_property_drift',
    severity: 'warning',
    description: 'Approved mappings must point to properties from the latest discovery.',
    sql: `
      SELECT CONCAT(m.semantic_key, ':', m.object_type) AS entity_id,
             m.workspace_id::text AS workspace_id,
             m.property_name
      FROM property_mappings m
      LEFT JOIN crm_properties p
        ON p.workspace_id = m.workspace_id
       AND p.object_type = m.object_type
       AND p.property_name = m.property_name
      WHERE p.property_name IS NULL
        AND ($1::uuid IS NULL OR m.workspace_id = $1)
      ORDER BY m.workspace_id, m.semantic_key, m.object_type
      LIMIT $2
    `
  },
  {
    key: 'orphaned_export_jobs',
    severity: 'warning',
    description: 'Export jobs must retain their workspace and requesting user references.',
    sql: `
      SELECT e.id::text AS entity_id, e.workspace_id::text AS workspace_id
      FROM report_export_jobs e
      LEFT JOIN workspaces w ON w.id = e.workspace_id
      LEFT JOIN app_users u ON u.id = e.requested_by_user_id
      WHERE (w.id IS NULL OR u.id IS NULL)
        AND ($1::uuid IS NULL OR e.workspace_id = $1)
      ORDER BY e.created_at
      LIMIT $2
    `
  }
]);

const SENSITIVE_METADATA_KEYS = new Set([
  'raw', 'properties', 'payload', 'body', 'access_token', 'refresh_token',
  'access_token_encrypted', 'refresh_token_encrypted', 'password_hash', 'artifact'
]);

function sanitizeRow(row) {
  return {
    entityId: String(row.entity_id ?? '').slice(0, 300),
    workspaceId: row.workspace_id ? String(row.workspace_id) : null,
    occurrences: row.occurrences === undefined ? undefined : Number(row.occurrences),
    workspaceIds: Array.isArray(row.workspace_ids) ? row.workspace_ids.map(String).slice(0, 20) : undefined,
    metadata: Object.fromEntries(
      Object.entries(row)
        .filter(([key]) => !['entity_id', 'workspace_id', 'workspace_ids', 'occurrences'].includes(key))
        .filter(([key]) => !SENSITIVE_METADATA_KEYS.has(key.toLowerCase()))
        .map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value])
    )
  };
}

function queryValues(sql, options) {
  const placeholders = [...String(sql).matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
  const highest = placeholders.length ? Math.max(...placeholders) : 0;
  return [options.workspaceId, options.limit, options.staleHours].slice(0, highest);
}

export async function runTenantIntegrityAudit(postgres, input = {}) {
  const options = normalizeTenantAuditOptions(input);
  const startedAt = new Date();
  const results = [];

  for (const check of CHECKS) {
    try {
      const queryResult = await postgres.query(check.sql, queryValues(check.sql, options));
      const rows = queryResult.rows.map(sanitizeRow);
      results.push({
        key: check.key,
        severity: check.severity,
        description: check.description,
        status: rows.length ? 'failed' : 'passed',
        count: rows.length,
        truncated: rows.length >= options.limit,
        samples: rows
      });
    } catch (error) {
      const missingRelation = String(error?.code ?? '') === '42P01';
      results.push({
        key: check.key,
        severity: missingRelation ? 'info' : 'critical',
        description: check.description,
        status: missingRelation ? 'not_applicable' : 'error',
        count: 0,
        truncated: false,
        samples: [],
        error: missingRelation ? 'Required feature table is not installed yet.' : 'Integrity check could not be completed.'
      });
    }
  }

  const failed = results.filter((item) => item.status === 'failed' || item.status === 'error');
  const critical = failed.filter((item) => item.severity === 'critical');
  const warning = failed.filter((item) => item.severity === 'warning');
  const status = critical.length ? 'critical' : warning.length ? 'degraded' : 'healthy';

  return {
    status,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    scope: options.workspaceId ? { workspaceId: options.workspaceId } : { fleet: true },
    configuration: { limit: options.limit, staleHours: options.staleHours },
    summary: {
      checks: results.length,
      passed: results.filter((item) => item.status === 'passed').length,
      failed: failed.length,
      critical: critical.length,
      warning: warning.length,
      notApplicable: results.filter((item) => item.status === 'not_applicable').length
    },
    results
  };
}

export function tenantAuditExitCode(report) {
  if (report.status === 'healthy') return 0;
  if (report.status === 'degraded') return 2;
  return 3;
}

export const TENANT_INTEGRITY_CHECKS = CHECKS;
