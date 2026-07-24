import { pathToFileURL } from 'node:url';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_FRESHNESS_HOURS = 24;
const CORE_OBJECTS = ['contacts', 'companies', 'deals'];

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
      `SELECT status,mode,records_processed,started_at,completed_at,error
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
       FROM workspace_audit_logs WHERE workspace_id=$1`,
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

  const checks = [
    check(
      'workspace_active',
      'Workspace is active',
      workspace.status === 'active' ? 'pass' : 'blocked',
      workspace.status === 'active' ? 'Workspace lifecycle is active.' : `Workspace status is ${workspace.status || 'unknown'}.`,
      'Activate the workspace before production use.',
      { status: workspace.status }
    ),
    check(
      'hubspot_connected',
      'HubSpot OAuth connection',
      workspace.portal_id && workspace.connection_status === 'connected' ? 'pass' : 'blocked',
      workspace.portal_id ? `Portal ${workspace.portal_id} is ${workspace.connection_status || 'unknown'}.` : 'No HubSpot portal is connected.',
      'Complete HubSpot OAuth and confirm the connection is healthy.',
      { portalId: workspace.portal_id ? Number(workspace.portal_id) : null, status: workspace.connection_status, scopeCount: asNumber(workspace.scope_count) }
    ),
    check(
      'schema_discovered',
      'CRM schema discovery',
      missingCoreObjects.length === 0 && workspace.last_discovered_at ? 'pass' : 'blocked',
      missingCoreObjects.length === 0 ? 'Contacts, companies, and deals were discovered.' : `Missing discovered properties for: ${missingCoreObjects.join(', ')}.`,
      'Run portal discovery and resolve any HubSpot permission errors.',
      { lastDiscoveredAt: iso(workspace.last_discovered_at), objectTypes: properties.map((row) => String(row.object_type)), missingCoreObjects }
    ),
    check(
      'semantic_mappings',
      'Approved semantic mappings',
      asNumber(mapping.approved_count) > 0 ? 'pass' : 'blocked',
      asNumber(mapping.approved_count) > 0 ? `${asNumber(mapping.approved_count)} semantic mappings are approved.` : 'No semantic mappings are approved.',
      'Review mapping suggestions and approve the required reporting fields.',
      { approvedCount: asNumber(mapping.approved_count), userApprovedCount: asNumber(mapping.user_approved_count), latestMappingAt: iso(mapping.latest_mapping_at) }
    ),
    check(
      'initial_sync',
      'Initial CRM synchronization',
      latestSync?.status === 'completed' && asNumber(records.record_count) > 0 ? 'pass' : 'blocked',
      latestSync ? `Latest sync is ${latestSync.status} with ${asNumber(records.record_count)} mirrored records.` : 'No synchronization run was found.',
      'Run an initial sync and resolve any failed object or permission errors.',
      { status: latestSync?.status ?? null, mode: latestSync?.mode ?? null, recordsProcessed: asNumber(latestSync?.records_processed), completedAt: iso(latestSync?.completed_at), mirroredRecords: asNumber(records.record_count) }
    ),
    check(
      'data_freshness',
      'Data freshness SLA',
      freshnessAgeHours === null ? 'blocked' : freshnessAgeHours <= boundedFreshnessHours ? 'pass' : 'warning',
      freshnessAgeHours === null ? 'No synchronized CRM records have a freshness timestamp.' : `Newest CRM data is ${freshnessAgeHours.toFixed(1)} hours old.`,
      `Restore incremental synchronization and keep freshness within ${boundedFreshnessHours} hours.`,
      { newestSyncAt: iso(records.newest_sync), ageHours: freshnessAgeHours === null ? null : Number(freshnessAgeHours.toFixed(2)), thresholdHours: boundedFreshnessHours }
    ),
    check(
      'workspace_ownership',
      'Workspace ownership and administration',
      asNumber(membership.owner_count) > 0 ? 'pass' : 'blocked',
      `${asNumber(membership.member_count)} members, ${asNumber(membership.owner_count)} owners, ${asNumber(membership.admin_count)} owner/admin users.`,
      'Assign at least one active owner and a backup administrator.',
      { memberCount: asNumber(membership.member_count), ownerCount: asNumber(membership.owner_count), adminCount: asNumber(membership.admin_count) }
    ),
    check(
      'auditability',
      'Workspace audit trail',
      asNumber(audit.audit_count) > 0 ? 'pass' : 'warning',
      asNumber(audit.audit_count) > 0 ? `${asNumber(audit.audit_count)} audit events are recorded.` : 'No workspace audit events are recorded yet.',
      'Confirm onboarding actions are written to the workspace audit trail.',
      { eventCount: asNumber(audit.audit_count), latestEventAt: iso(audit.latest_audit_at) }
    )
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
