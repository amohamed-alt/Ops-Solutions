import { pathToFileURL } from 'node:url';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_FRESHNESS_HOURS = 24;
const CORE_OBJECTS = ['contacts', 'companies', 'deals'];
const MIGRATION_VERSION = 34;
const MIGRATION_LOCK = 812341264;
const MAX_HISTORY_LIMIT = 100;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS onboarding_readiness_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    evaluated_by_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
    trigger_source TEXT NOT NULL DEFAULT 'customer_api'
      CHECK (trigger_source IN ('customer_api','admin_api','system','cli')),
    ready BOOLEAN NOT NULL,
    score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
    blockers INTEGER NOT NULL CHECK (blockers >= 0),
    warnings INTEGER NOT NULL CHECK (warnings >= 0),
    previous_ready BOOLEAN,
    transitioned BOOLEAN NOT NULL DEFAULT FALSE,
    policy JSONB NOT NULL DEFAULT '{}'::jsonb,
    checks JSONB NOT NULL DEFAULT '[]'::jsonb,
    next_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    generated_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS onboarding_readiness_snapshots_workspace_created_idx
    ON onboarding_readiness_snapshots(workspace_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS onboarding_readiness_snapshots_transition_idx
    ON onboarding_readiness_snapshots(workspace_id, created_at DESC)
    WHERE transitioned = TRUE;
`;

function readinessError(message, statusCode = 400, category = 'ONBOARDING_READINESS_INVALID') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.category = category;
  return error;
}

function asNumber(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function hoursSince(value, now = new Date()) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, (now.getTime() - timestamp) / 3_600_000);
}

function check(key, label, state, detail, action, evidence = {}) {
  return { key, label, state, blocking: state === 'blocked', detail, action, evidence };
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function summarizeReadiness(checks) {
  const counts = checks.reduce((result, item) => {
    result[item.state] = (result[item.state] ?? 0) + 1;
    return result;
  }, { pass: 0, warning: 0, blocked: 0 });
  const total = checks.length;
  const score = total > 0 ? Math.round(((counts.pass + counts.warning * 0.5) / total) * 100) : 0;
  return {
    ready: counts.blocked === 0,
    score,
    total,
    passed: counts.pass,
    warnings: counts.warning,
    blockers: counts.blocked
  };
}

export async function ensureOnboardingReadinessSchema(postgres) {
  const client = await postgres.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${MIGRATION_LOCK})`);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    const existing = await client.query('SELECT 1 FROM schema_migrations WHERE version=$1', [MIGRATION_VERSION]);
    if (existing.rowCount > 0) return { applied: false, version: MIGRATION_VERSION };
    await client.query('BEGIN');
    try {
      await client.query(SCHEMA_SQL);
      await client.query(
        'INSERT INTO schema_migrations(version,name) VALUES($1,$2)',
        [MIGRATION_VERSION, 'onboarding_readiness_snapshots']
      );
      await client.query('COMMIT');
      return { applied: true, version: MIGRATION_VERSION };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${MIGRATION_LOCK})`).catch(() => undefined);
    client.release();
  }
}

export async function evaluateWorkspaceOnboardingReadiness(postgres, workspaceId, {
  freshnessHours = DEFAULT_FRESHNESS_HOURS,
  now = new Date()
} = {}) {
  if (!UUID_PATTERN.test(String(workspaceId ?? ''))) {
    throw readinessError('A valid workspace UUID is required.');
  }
  const boundedFreshnessHours = Math.max(1, Math.min(168, Number(freshnessHours) || DEFAULT_FRESHNESS_HOURS));

  const [workspaceResult, propertyResult, mappingResult, syncResult, recordsResult, membershipResult, auditResult] = await Promise.all([
    postgres.query(
      `SELECT w.id,w.name,w.status,w.created_at,
              c.portal_id,c.status AS connection_status,c.last_discovered_at,c.last_error,
              COALESCE(jsonb_array_length(c.scopes),0)::int AS scope_count
       FROM workspaces w
       LEFT JOIN hubspot_connections c ON c.workspace_id=w.id
       WHERE w.id=$1`,
      [workspaceId]
    ),
    postgres.query(
      `SELECT object_type,COUNT(*)::int AS property_count,MAX(discovered_at) AS discovered_at
       FROM crm_properties WHERE workspace_id=$1
       GROUP BY object_type ORDER BY object_type`,
      [workspaceId]
    ),
    postgres.query(
      `SELECT COUNT(*)::int AS approved_count,
              COUNT(*) FILTER (WHERE source='user_approved')::int AS user_approved_count,
              MAX(updated_at) AS latest_mapping_at
       FROM property_mappings WHERE workspace_id=$1`,
      [workspaceId]
    ),
    postgres.query(
      `SELECT status,mode,summary,started_at,completed_at,error
       FROM sync_runs WHERE workspace_id=$1
       ORDER BY started_at DESC LIMIT 1`,
      [workspaceId]
    ),
    postgres.query(
      `SELECT COUNT(*)::int AS record_count,MAX(synced_at) AS newest_sync,
              COUNT(DISTINCT object_type)::int AS object_count
       FROM crm_records WHERE workspace_id=$1`,
      [workspaceId]
    ),
    postgres.query(
      `SELECT COUNT(*)::int AS member_count,
              COUNT(*) FILTER (WHERE role='owner')::int AS owner_count,
              COUNT(*) FILTER (WHERE role IN ('owner','admin'))::int AS admin_count
       FROM workspace_memberships WHERE workspace_id=$1`,
      [workspaceId]
    ),
    postgres.query(
      `SELECT COUNT(*)::int AS audit_count,MAX(created_at) AS latest_audit_at
       FROM audit_events WHERE workspace_id=$1`,
      [workspaceId]
    )
  ]);

  if (workspaceResult.rowCount === 0) {
    throw readinessError('Workspace not found.', 404, 'WORKSPACE_NOT_FOUND');
  }

  const workspace = workspaceResult.rows[0];
  const properties = propertyResult.rows;
  const propertyMap = new Map(properties.map((row) => [String(row.object_type), asNumber(row.property_count)]));
  const missingCoreObjects = CORE_OBJECTS.filter((objectType) => !propertyMap.get(objectType));
  const mapping = mappingResult.rows[0] ?? {};
  const latestSync = syncResult.rows[0] ?? null;
  const records = recordsResult.rows[0] ?? {};
  const membership = membershipResult.rows[0] ?? {};
  const audit = auditResult.rows[0] ?? {};
  const freshnessAgeHours = hoursSince(records.newest_sync, now);
  const syncSummary = latestSync?.summary && typeof latestSync.summary === 'object' ? latestSync.summary : {};

  const checks = [
    check('workspace_active', 'Workspace is active', workspace.status === 'active' ? 'pass' : 'blocked', workspace.status === 'active' ? 'Workspace lifecycle is active.' : `Workspace status is ${workspace.status || 'unknown'}.`, 'Activate the workspace before production use.', { status: workspace.status }),
    check('hubspot_connected', 'HubSpot OAuth connection', workspace.portal_id && workspace.connection_status === 'connected' ? 'pass' : 'blocked', workspace.portal_id ? `Portal ${workspace.portal_id} is ${workspace.connection_status || 'unknown'}.` : 'No HubSpot portal is connected.', 'Complete HubSpot OAuth and confirm the connection is healthy.', { portalId: workspace.portal_id ? Number(workspace.portal_id) : null, status: workspace.connection_status, scopeCount: asNumber(workspace.scope_count) }),
    check('schema_discovered', 'CRM schema discovery', missingCoreObjects.length === 0 && workspace.last_discovered_at ? 'pass' : 'blocked', missingCoreObjects.length === 0 ? 'Contacts, companies, and deals were discovered.' : `Missing discovered properties for: ${missingCoreObjects.join(', ')}.`, 'Run portal discovery and resolve any HubSpot permission errors.', { lastDiscoveredAt: iso(workspace.last_discovered_at), objectTypes: properties.map((row) => String(row.object_type)), missingCoreObjects }),
    check('semantic_mappings', 'Approved semantic mappings', asNumber(mapping.approved_count) > 0 ? 'pass' : 'blocked', asNumber(mapping.approved_count) > 0 ? `${asNumber(mapping.approved_count)} semantic mappings are approved.` : 'No semantic mappings are approved.', 'Review mapping suggestions and approve the required reporting fields.', { approvedCount: asNumber(mapping.approved_count), userApprovedCount: asNumber(mapping.user_approved_count), latestMappingAt: iso(mapping.latest_mapping_at) }),
    check('initial_sync', 'Initial CRM synchronization', latestSync?.status === 'completed' && asNumber(records.record_count) > 0 ? 'pass' : 'blocked', latestSync ? `Latest sync is ${latestSync.status} with ${asNumber(records.record_count)} mirrored records.` : 'No synchronization run was found.', 'Run an initial sync and resolve any failed object or permission errors.', { status: latestSync?.status ?? null, mode: latestSync?.mode ?? null, summary: syncSummary, completedAt: iso(latestSync?.completed_at), mirroredRecords: asNumber(records.record_count) }),
    check('data_freshness', 'Data freshness SLA', freshnessAgeHours === null ? 'blocked' : freshnessAgeHours <= boundedFreshnessHours ? 'pass' : 'warning', freshnessAgeHours === null ? 'No synchronized CRM records have a freshness timestamp.' : `Newest CRM data is ${freshnessAgeHours.toFixed(1)} hours old.`, `Restore incremental synchronization and keep freshness within ${boundedFreshnessHours} hours.`, { newestSyncAt: iso(records.newest_sync), ageHours: freshnessAgeHours === null ? null : Number(freshnessAgeHours.toFixed(2)), thresholdHours: boundedFreshnessHours }),
    check('workspace_ownership', 'Workspace ownership and administration', asNumber(membership.owner_count) > 0 ? 'pass' : 'blocked', `${asNumber(membership.member_count)} members, ${asNumber(membership.owner_count)} owners, ${asNumber(membership.admin_count)} owner/admin users.`, 'Assign at least one active owner and a backup administrator.', { memberCount: asNumber(membership.member_count), ownerCount: asNumber(membership.owner_count), adminCount: asNumber(membership.admin_count) }),
    check('auditability', 'Workspace audit trail', asNumber(audit.audit_count) > 0 ? 'pass' : 'warning', asNumber(audit.audit_count) > 0 ? `${asNumber(audit.audit_count)} audit events are recorded.` : 'No workspace audit events are recorded yet.', 'Confirm onboarding actions are written to the workspace audit trail.', { eventCount: asNumber(audit.audit_count), latestEventAt: iso(audit.latest_audit_at) })
  ];

  return {
    workspace: { id: workspace.id, name: workspace.name, status: workspace.status },
    generatedAt: now.toISOString(),
    policy: { freshnessHours: boundedFreshnessHours, requiredCoreObjects: CORE_OBJECTS },
    summary: summarizeReadiness(checks),
    checks,
    nextActions: checks.filter((item) => item.state !== 'pass').map((item) => ({ key: item.key, state: item.state, action: item.action }))
  };
}

export async function persistReadinessSnapshot(client, report, {
  userId = null,
  triggerSource = 'customer_api'
} = {}) {
  const workspaceId = report?.workspace?.id;
  if (!UUID_PATTERN.test(String(workspaceId ?? ''))) throw readinessError('A valid report workspace is required.');
  if (userId !== null && !UUID_PATTERN.test(String(userId))) throw readinessError('A valid evaluator user ID is required.');
  if (!['customer_api', 'admin_api', 'system', 'cli'].includes(triggerSource)) throw readinessError('Unsupported readiness trigger source.');

  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`onboarding-readiness:${workspaceId}`]);
  const previousResult = await client.query(
    `SELECT ready FROM onboarding_readiness_snapshots
     WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`,
    [workspaceId]
  );
  const previousReady = previousResult.rows[0]?.ready ?? null;
  const transitioned = previousReady !== null && previousReady !== report.summary.ready;
  const inserted = await client.query(
    `INSERT INTO onboarding_readiness_snapshots (
       workspace_id,evaluated_by_user_id,trigger_source,ready,score,blockers,warnings,
       previous_ready,transitioned,policy,checks,next_actions,generated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13)
     RETURNING id,workspace_id,ready,score,blockers,warnings,previous_ready,transitioned,
               trigger_source,generated_at,created_at`,
    [
      workspaceId,
      userId,
      triggerSource,
      report.summary.ready,
      report.summary.score,
      report.summary.blockers,
      report.summary.warnings,
      previousReady,
      transitioned,
      JSON.stringify(report.policy),
      JSON.stringify(report.checks),
      JSON.stringify(report.nextActions),
      report.generatedAt
    ]
  );
  return inserted.rows[0];
}

export async function evaluateAndPersistReadiness({ postgres, withTransaction, workspaceId, options = {}, userId = null, triggerSource = 'customer_api' }) {
  const report = await evaluateWorkspaceOnboardingReadiness(postgres, workspaceId, options);
  const snapshot = await withTransaction((client) => persistReadinessSnapshot(client, report, { userId, triggerSource }));
  return { ...report, snapshot };
}

function serializeSnapshot(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ready: row.ready,
    score: row.score,
    blockers: row.blockers,
    warnings: row.warnings,
    previousReady: row.previous_ready,
    transitioned: row.transitioned,
    triggerSource: row.trigger_source,
    policy: row.policy ?? {},
    checks: row.checks ?? [],
    nextActions: row.next_actions ?? [],
    generatedAt: row.generated_at,
    createdAt: row.created_at
  };
}

export function registerOnboardingReadinessRoutes(app, {
  postgres,
  withTransaction,
  requireViewer,
  requireAdmin,
  writeAudit
}) {
  const basePath = '/api/v1/customer/workspaces/:workspaceId/onboarding-readiness';

  app.get(basePath, { preHandler: requireViewer }, async (request) => ({
    role: request.workspaceMembership.role,
    ...(await evaluateWorkspaceOnboardingReadiness(postgres, request.params.workspaceId, {
      freshnessHours: request.query?.freshnessHours
    }))
  }));

  app.get(`${basePath}/history`, { preHandler: requireViewer }, async (request) => {
    const limit = boundedInteger(request.query?.limit, 30, 1, MAX_HISTORY_LIMIT);
    const transitionsOnly = String(request.query?.transitionsOnly ?? 'false') === 'true';
    const result = await postgres.query(
      `SELECT id,workspace_id,ready,score,blockers,warnings,previous_ready,transitioned,
              trigger_source,policy,checks,next_actions,generated_at,created_at
       FROM onboarding_readiness_snapshots
       WHERE workspace_id=$1 ${transitionsOnly ? 'AND transitioned=TRUE' : ''}
       ORDER BY created_at DESC,id DESC LIMIT $2`,
      [request.params.workspaceId, limit]
    );
    return { results: result.rows.map(serializeSnapshot), limit, transitionsOnly };
  });

  app.post(`${basePath}/evaluate`, { preHandler: requireAdmin }, async (request, reply) => {
    const report = await evaluateAndPersistReadiness({
      postgres,
      withTransaction,
      workspaceId: request.params.workspaceId,
      options: { freshnessHours: request.body?.freshnessHours },
      userId: request.customer.user.id,
      triggerSource: 'customer_api'
    });
    await writeAudit(request, {
      workspaceId: request.params.workspaceId,
      actorUserId: request.customer.user.id,
      action: 'onboarding.readiness_evaluated',
      targetType: 'workspace',
      targetId: request.params.workspaceId,
      metadata: {
        snapshotId: report.snapshot.id,
        ready: report.summary.ready,
        score: report.summary.score,
        blockers: report.summary.blockers,
        warnings: report.summary.warnings,
        transitioned: report.snapshot.transitioned
      }
    });
    return reply.code(201).send(report);
  });
}

function parseCliArgs(argv) {
  const options = { format: 'text', freshnessHours: DEFAULT_FRESHNESS_HOURS };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--workspace') options.workspaceId = argv[++index];
    else if (value === '--format') options.format = String(argv[++index] ?? 'text').toLowerCase();
    else if (value === '--freshness-hours') options.freshnessHours = Number(argv[++index]);
    else if (value === '--help') options.help = true;
    else throw readinessError(`Unknown argument: ${value}`);
  }
  if (!['text', 'json'].includes(options.format)) throw readinessError('Format must be text or json.');
  return options;
}

function renderText(report) {
  const lines = [
    `Workspace onboarding readiness: ${report.workspace.name}`,
    `Status: ${report.summary.ready ? 'READY' : 'NOT READY'} | Score: ${report.summary.score}% | Blockers: ${report.summary.blockers} | Warnings: ${report.summary.warnings}`,
    ''
  ];
  for (const item of report.checks) {
    const marker = item.state === 'pass' ? 'PASS' : item.state === 'warning' ? 'WARN' : 'BLOCK';
    lines.push(`[${marker}] ${item.label}: ${item.detail}`);
    if (item.state !== 'pass') lines.push(`        Next: ${item.action}`);
  }
  return lines.join('\n');
}

async function runCli() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node apps/api/src/onboarding-readiness.js --workspace <uuid> [--format text|json] [--freshness-hours 24]');
    return;
  }
  if (!options.workspaceId) throw readinessError('--workspace is required.');
  const { postgres } = await import('./database.js');
  try {
    const report = await evaluateWorkspaceOnboardingReadiness(postgres, options.workspaceId, options);
    console.log(options.format === 'json' ? JSON.stringify(report, null, 2) : renderText(report));
    process.exitCode = report.summary.ready ? 0 : 2;
  } finally {
    await postgres.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runCli().catch((error) => {
    console.error(JSON.stringify({ error: error.category ?? 'ONBOARDING_READINESS_FAILED', message: error.message }));
    process.exitCode = 4;
  });
}
