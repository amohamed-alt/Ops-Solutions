import {
  AnalyticsDefinitionError,
  compileDrilldownQuery,
  compileMetricQuery,
  indexTemplate
} from './analytics.js';
import { sdrDashboardTemplate } from './templates/sdr-dashboard.js';

const indexedTemplate = indexTemplate(sdrDashboardTemplate);

function numericValue(value) {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function serializeMetricRows(rows, grouped = false) {
  if (!grouped) return numericValue(rows?.[0]?.value);
  return (rows ?? []).map((row) => ({
    key: row.group_key || 'Unassigned',
    value: numericValue(row.value)
  }));
}

function jsonTimestampSql(propertyName, alias = 'r') {
  return `CASE
    WHEN ${alias}.properties->>'${propertyName}' ~ '^\\d{4}-\\d{2}-\\d{2}'
      THEN (${alias}.properties->>'${propertyName}')::timestamptz
    WHEN ${alias}.properties->>'${propertyName}' ~ '^\\d{10,13}$'
      THEN to_timestamp(((${alias}.properties->>'${propertyName}')::numeric) /
        CASE WHEN length(${alias}.properties->>'${propertyName}') >= 13 THEN 1000 ELSE 1 END)
    ELSE NULL
  END`;
}

function activityTimestampSql(alias = 'r') {
  return `COALESCE(
    ${jsonTimestampSql('hs_timestamp', alias)},
    ${jsonTimestampSql('hs_meeting_start_time', alias)},
    ${alias}.hubspot_created_at,
    ${alias}.hubspot_updated_at,
    ${alias}.synced_at
  )`;
}

function activityOwnerSql(alias = 'r') {
  return `COALESCE(
    NULLIF(${alias}.properties->>'hubspot_owner_id', ''),
    NULLIF(${alias}.properties->>'hs_activity_assigned_to_user_id', ''),
    NULLIF(${alias}.properties->>'hs_created_by_user_id', ''),
    'Unassigned'
  )`;
}

export async function executeActivityWindowMetric(postgres, workspaceId, definition) {
  const days = Math.max(1, Math.min(3650, Number(definition.activityWindowDays ?? 30)));
  const grouped = Boolean(definition.groupBy);
  const timestamp = activityTimestampSql('r');
  const owner = activityOwnerSql('r');
  const select = grouped
    ? `${owner} AS group_key, COUNT(*)::bigint AS value`
    : 'COUNT(*)::bigint AS value';
  const groupBy = grouped ? `GROUP BY ${owner} ORDER BY value DESC` : '';

  const result = await postgres.query(
    `SELECT ${select}
     FROM crm_records r
     WHERE r.workspace_id = $1
       AND r.object_type = $2
       AND r.archived = FALSE
       AND ${timestamp} >= NOW() - ($3::int * INTERVAL '1 day')
     ${groupBy}`,
    [workspaceId, definition.objectType, days]
  );

  return serializeMetricRows(result.rows, grouped);
}

export async function executeActivityTrend(postgres, workspaceId, days = 21) {
  const safeDays = Math.max(7, Math.min(90, Number(days) || 21));
  const timestamp = activityTimestampSql('r');
  const result = await postgres.query(
    `WITH dates AS (
       SELECT generate_series(
         CURRENT_DATE - (($2::int - 1) * INTERVAL '1 day'),
         CURRENT_DATE,
         INTERVAL '1 day'
       )::date AS day
     ), activity AS (
       SELECT
         date_trunc('day', ${timestamp})::date AS day,
         COUNT(*) FILTER (WHERE r.object_type = 'calls')::int AS calls,
         COUNT(*) FILTER (WHERE r.object_type = 'meetings')::int AS meetings,
         COUNT(*) FILTER (WHERE r.object_type = 'tasks')::int AS tasks
       FROM crm_records r
       WHERE r.workspace_id = $1
         AND r.object_type IN ('calls', 'meetings', 'tasks')
         AND r.archived = FALSE
         AND ${timestamp} >= CURRENT_DATE - (($2::int - 1) * INTERVAL '1 day')
       GROUP BY 1
     )
     SELECT
       to_char(d.day, 'YYYY-MM-DD') AS day,
       COALESCE(a.calls, 0)::int AS calls,
       COALESCE(a.meetings, 0)::int AS meetings,
       COALESCE(a.tasks, 0)::int AS tasks
     FROM dates d
     LEFT JOIN activity a ON a.day = d.day
     ORDER BY d.day`,
    [workspaceId, safeDays]
  );

  return result.rows.map((row) => ({
    day: row.day,
    calls: numericValue(row.calls),
    meetings: numericValue(row.meetings),
    tasks: numericValue(row.tasks)
  }));
}

export async function executeLeadStatusDistribution(postgres, workspaceId) {
  const result = await postgres.query(
    `SELECT
       COALESCE(
         NULLIF(properties->>'hs_lead_status', ''),
         NULLIF(properties->>'lifecyclestage', ''),
         'Unknown'
       ) AS group_key,
       COUNT(*)::bigint AS value
     FROM crm_records
     WHERE workspace_id = $1
       AND object_type = 'contacts'
       AND archived = FALSE
     GROUP BY 1
     ORDER BY value DESC, group_key
     LIMIT 8`,
    [workspaceId]
  );
  return serializeMetricRows(result.rows, true);
}

export async function executeOperationalSnapshot(postgres, workspaceId) {
  const taskDue = `COALESCE(${jsonTimestampSql('hs_timestamp', 'r')}, r.hubspot_created_at)`;
  const result = await postgres.query(
    `SELECT
       COUNT(*) FILTER (
         WHERE r.object_type = 'companies'
       )::bigint AS total_companies,
       COUNT(*) FILTER (
         WHERE r.object_type = 'tasks'
           AND UPPER(COALESCE(r.properties->>'hs_task_status', '')) NOT IN ('COMPLETED', 'DONE', 'CLOSED')
       )::bigint AS open_tasks,
       COUNT(*) FILTER (
         WHERE r.object_type = 'deals'
           AND LOWER(COALESCE(r.properties->>'hs_is_closed', 'false')) NOT IN ('true', '1')
       )::bigint AS open_deals,
       COUNT(*) FILTER (
         WHERE r.object_type = 'contacts'
           AND NULLIF(r.properties->>'hubspot_owner_id', '') IS NULL
       )::bigint AS missing_owner,
       COUNT(*) FILTER (
         WHERE r.object_type = 'tasks'
           AND UPPER(COALESCE(r.properties->>'hs_task_status', '')) NOT IN ('COMPLETED', 'DONE', 'CLOSED')
           AND (${taskDue})::date = CURRENT_DATE
       )::bigint AS tasks_due_today,
       COUNT(*) FILTER (
         WHERE r.object_type = 'tasks'
           AND UPPER(COALESCE(r.properties->>'hs_task_status', '')) NOT IN ('COMPLETED', 'DONE', 'CLOSED')
           AND (${taskDue})::date < CURRENT_DATE
       )::bigint AS overdue_tasks,
       COUNT(*) FILTER (
         WHERE r.object_type = 'tasks'
           AND UPPER(COALESCE(r.properties->>'hs_task_status', '')) NOT IN ('COMPLETED', 'DONE', 'CLOSED')
           AND UPPER(COALESCE(r.properties->>'hs_task_priority', '')) = 'HIGH'
       )::bigint AS high_priority_tasks,
       COUNT(*) FILTER (
         WHERE r.object_type = 'deals'
           AND LOWER(COALESCE(r.properties->>'hs_is_closed', 'false')) NOT IN ('true', '1')
           AND NULLIF(r.properties->>'hs_next_activity_date', '') IS NULL
       )::bigint AS no_next_activity
     FROM crm_records r
     WHERE r.workspace_id = $1
       AND r.archived = FALSE`,
    [workspaceId]
  );
  const row = result.rows[0] ?? {};
  return {
    totalCompanies: numericValue(row.total_companies),
    openTasks: numericValue(row.open_tasks),
    openDeals: numericValue(row.open_deals),
    missingOwner: numericValue(row.missing_owner),
    tasksDueToday: numericValue(row.tasks_due_today),
    overdueTasks: numericValue(row.overdue_tasks),
    highPriorityTasks: numericValue(row.high_priority_tasks),
    noNextActivity: numericValue(row.no_next_activity)
  };
}

export async function executeConversionFunnel(postgres, workspaceId) {
  const meetingTimestamp = activityTimestampSql('meeting_record');
  const result = await postgres.query(
    `WITH contacts AS (
       SELECT record_id, properties
       FROM crm_records
       WHERE workspace_id = $1 AND object_type = 'contacts' AND archived = FALSE
     ), contacted AS (
       SELECT DISTINCT c.record_id
       FROM contacts c
       WHERE NULLIF(c.properties->>'notes_last_contacted', '') IS NOT NULL
          OR EXISTS (
            SELECT 1
            FROM crm_record_associations a
            WHERE a.workspace_id = $1
              AND a.to_object_type = 'contacts'
              AND a.to_record_id = c.record_id
              AND a.from_object_type IN ('calls', 'meetings', 'deals')
          )
     ), meeting_contacts AS (
       SELECT DISTINCT a.to_record_id AS record_id
       FROM crm_record_associations a
       JOIN crm_records meeting_record
         ON meeting_record.workspace_id = a.workspace_id
        AND meeting_record.object_type = 'meetings'
        AND meeting_record.record_id = a.from_record_id
        AND meeting_record.archived = FALSE
       WHERE a.workspace_id = $1
         AND a.from_object_type = 'meetings'
         AND a.to_object_type = 'contacts'
         AND ${meetingTimestamp} >= NOW() - INTERVAL '30 days'
     ), opportunity_contacts AS (
       SELECT DISTINCT a.to_record_id AS record_id
       FROM crm_record_associations a
       JOIN crm_records deal_record
         ON deal_record.workspace_id = a.workspace_id
        AND deal_record.object_type = 'deals'
        AND deal_record.record_id = a.from_record_id
        AND deal_record.archived = FALSE
       WHERE a.workspace_id = $1
         AND a.from_object_type = 'deals'
         AND a.to_object_type = 'contacts'
     ), won_contacts AS (
       SELECT DISTINCT a.to_record_id AS record_id
       FROM crm_record_associations a
       JOIN crm_records deal_record
         ON deal_record.workspace_id = a.workspace_id
        AND deal_record.object_type = 'deals'
        AND deal_record.record_id = a.from_record_id
        AND deal_record.archived = FALSE
       WHERE a.workspace_id = $1
         AND a.from_object_type = 'deals'
         AND a.to_object_type = 'contacts'
         AND LOWER(COALESCE(deal_record.properties->>'hs_is_closed_won', 'false')) IN ('true', '1')
     )
     SELECT
       (SELECT COUNT(*) FROM contacts)::bigint AS contacts,
       (SELECT COUNT(*) FROM contacted)::bigint AS contacted,
       (SELECT COUNT(*) FROM meeting_contacts)::bigint AS meetings,
       (SELECT COUNT(*) FROM opportunity_contacts)::bigint AS opportunities,
       (SELECT COUNT(*) FROM won_contacts)::bigint AS won`,
    [workspaceId]
  );
  const row = result.rows[0] ?? {};
  return [
    { key: 'contacts', label: 'Contacts', value: numericValue(row.contacts) },
    { key: 'contacted', label: 'Contacted', value: numericValue(row.contacted) },
    { key: 'meetings', label: 'Meeting contacts', value: numericValue(row.meetings) },
    { key: 'opportunities', label: 'Opportunities', value: numericValue(row.opportunities) },
    { key: 'won', label: 'Closed won', value: numericValue(row.won) }
  ];
}

async function loadMappings(postgres, workspaceId, objectType) {
  const result = await postgres.query(
    `SELECT semantic_key, property_name, value_mapping
     FROM property_mappings
     WHERE workspace_id = $1 AND object_type = $2`,
    [workspaceId, objectType]
  );

  return Object.fromEntries(result.rows.map((row) => [row.semantic_key, {
    propertyName: row.property_name,
    valueMapping: row.value_mapping ?? {}
  }]));
}

async function mappingReadiness(postgres, workspaceId) {
  const result = await postgres.query(
    `SELECT semantic_key, object_type, property_name, value_mapping
     FROM property_mappings
     WHERE workspace_id = $1
     ORDER BY semantic_key, object_type`,
    [workspaceId]
  );

  const approved = result.rows.map((row) => ({
    semanticKey: row.semantic_key,
    objectType: row.object_type,
    propertyName: row.property_name,
    valueMapping: row.value_mapping ?? {}
  }));
  const approvedKeys = new Set(approved.map((row) => row.semanticKey));

  return {
    approved,
    required: sdrDashboardTemplate.requiredSemanticFields.map((key) => ({
      key,
      approved: approvedKeys.has(key)
    })),
    optional: sdrDashboardTemplate.optionalSemanticFields.map((key) => ({
      key,
      approved: approvedKeys.has(key)
    }))
  };
}

async function executeMetric(postgres, workspaceId, definition) {
  if (definition.activityWindowDays) {
    return executeActivityWindowMetric(postgres, workspaceId, definition);
  }

  const mappings = await loadMappings(postgres, workspaceId, definition.objectType);
  const query = compileMetricQuery({
    workspaceId,
    definition,
    mappings,
    virtualProperties: indexedTemplate.virtualProperties
  });
  const result = await postgres.query(query.text, query.values);

  return serializeMetricRows(result.rows, Boolean(definition.groupBy));
}

function metricPublicDefinition(metric) {
  return {
    key: metric.key,
    label: metric.label,
    objectType: metric.objectType,
    aggregation: metric.aggregation,
    field: metric.field ?? null,
    groupBy: metric.groupBy ?? null,
    activityWindowDays: metric.activityWindowDays ?? null
  };
}

async function executeMetricSafely(postgres, workspaceId, definition) {
  try {
    return {
      ...metricPublicDefinition(definition),
      status: 'ready',
      value: await executeMetric(postgres, workspaceId, definition),
      error: null
    };
  } catch (error) {
    if (!(error instanceof AnalyticsDefinitionError)) throw error;
    return {
      ...metricPublicDefinition(definition),
      status: 'configuration_required',
      value: null,
      error: error.message
    };
  }
}

async function syncFreshness(postgres, workspaceId) {
  const result = await postgres.query(
    `SELECT
       COUNT(*)::bigint AS total_records,
       MAX(synced_at) AS latest_sync,
       MIN(synced_at) AS oldest_sync
     FROM crm_records
     WHERE workspace_id = $1 AND archived = FALSE`,
    [workspaceId]
  );
  const row = result.rows[0] ?? {};
  return {
    totalRecords: numericValue(row.total_records),
    latestSync: row.latest_sync ?? null,
    oldestSync: row.oldest_sync ?? null
  };
}

async function ownersIndex(postgres, workspaceId) {
  const result = await postgres.query(
    `SELECT owner_id, user_id, email, first_name, last_name, archived
     FROM crm_owners
     WHERE workspace_id = $1`,
    [workspaceId]
  );

  const entries = [];
  for (const row of result.rows) {
    const owner = {
      id: String(row.owner_id),
      name: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email || `Owner ${row.owner_id}`,
      email: row.email ?? null,
      archived: Boolean(row.archived)
    };
    entries.push([String(row.owner_id), owner]);
    if (row.user_id !== null && row.user_id !== undefined) {
      entries.push([String(row.user_id), owner]);
    }
  }
  return Object.fromEntries(entries);
}

export async function buildSdrDashboard(postgres, workspaceId) {
  const metricResults = await Promise.all(
    sdrDashboardTemplate.metrics.map((metric) => executeMetricSafely(postgres, workspaceId, metric))
  );

  const activityByOwnerDefinition = {
    key: 'activity_by_owner',
    label: 'Calls by Owner',
    objectType: 'calls',
    aggregation: 'count',
    groupBy: 'hubspot_owner_id',
    activityWindowDays: 30
  };
  const [
    activityByOwner,
    mappings,
    freshness,
    owners,
    activityTrend,
    conversionFunnel,
    leadStatus,
    operationalSnapshot
  ] = await Promise.all([
    executeMetricSafely(postgres, workspaceId, activityByOwnerDefinition),
    mappingReadiness(postgres, workspaceId),
    syncFreshness(postgres, workspaceId),
    ownersIndex(postgres, workspaceId),
    executeActivityTrend(postgres, workspaceId, 21),
    executeConversionFunnel(postgres, workspaceId),
    executeLeadStatusDistribution(postgres, workspaceId),
    executeOperationalSnapshot(postgres, workspaceId)
  ]);

  if (Array.isArray(activityByOwner.value)) {
    activityByOwner.value = activityByOwner.value.map((item) => ({
      ...item,
      owner: owners[item.key] ?? {
        id: item.key,
        name: item.key === 'Unassigned' ? 'Unassigned' : `Owner ${item.key}`,
        email: null,
        archived: false
      }
    }));
  }

  return {
    template: {
      key: sdrDashboardTemplate.key,
      name: sdrDashboardTemplate.name,
      version: sdrDashboardTemplate.version,
      description: sdrDashboardTemplate.description
    },
    generatedAt: new Date().toISOString(),
    freshness,
    mappingReadiness: mappings,
    metrics: Object.fromEntries(metricResults.map((metric) => [metric.key, metric])),
    leaderboards: {
      activityByOwner
    },
    activityTrend,
    conversionFunnel,
    leadStatus,
    operationalSnapshot,
    drilldowns: [
      {
        key: 'priority-leads-needing-action',
        label: 'Priority Leads Needing Action',
        objectType: 'contacts',
        columns: [
          'firstname', 'lastname', 'email', 'phone', 'company', 'country',
          'hubspot_owner_id', 'hs_lead_status', 'notes_last_contacted'
        ]
      }
    ]
  };
}

export async function getSdrMetric(postgres, workspaceId, metricKey) {
  const definition = indexedTemplate.metrics[metricKey];
  if (!definition) {
    const error = new Error(`Unknown SDR metric: ${metricKey}`);
    error.statusCode = 404;
    error.category = 'METRIC_NOT_FOUND';
    throw error;
  }
  return executeMetricSafely(postgres, workspaceId, definition);
}

async function fallbackAttentionDrilldown(postgres, workspaceId, limit, offset) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const result = await postgres.query(
    `SELECT
       record_id,
       properties,
       hubspot_created_at,
       hubspot_updated_at,
       synced_at
     FROM crm_records
     WHERE workspace_id = $1
       AND object_type = 'contacts'
       AND archived = FALSE
       AND (
         (
           NULLIF(properties->>'notes_last_contacted', '') IS NULL
           AND COALESCE(hubspot_created_at, synced_at) < NOW() - INTERVAL '2 days'
         )
         OR (
           NULLIF(properties->>'notes_last_contacted', '') IS NOT NULL
           AND (properties->>'notes_last_contacted')::timestamptz < NOW() - INTERVAL '21 days'
         )
       )
     ORDER BY
       CASE WHEN NULLIF(properties->>'notes_last_contacted', '') IS NULL THEN 0 ELSE 1 END,
       COALESCE(hubspot_created_at, synced_at) ASC,
       record_id
     LIMIT $2 OFFSET $3`,
    [workspaceId, safeLimit, safeOffset]
  );
  return { rows: result.rows, limit: safeLimit, offset: safeOffset, fallback: true };
}

export async function getPriorityLeadDrilldown(postgres, workspaceId, { limit, offset } = {}) {
  const widget = sdrDashboardTemplate.widgets.find((item) => item.type === 'table');
  const mappings = await loadMappings(postgres, workspaceId, widget.objectType);
  let rows;
  let queryLimit;
  let queryOffset;
  let fallback = false;

  try {
    const query = compileDrilldownQuery({
      workspaceId,
      objectType: widget.objectType,
      filters: widget.filters,
      mappings,
      virtualProperties: indexedTemplate.virtualProperties,
      limit,
      offset
    });
    const result = await postgres.query(query.text, query.values);
    rows = result.rows;
    queryLimit = query.limit;
    queryOffset = query.offset;
  } catch (error) {
    if (!(error instanceof AnalyticsDefinitionError)) throw error;
    const result = await fallbackAttentionDrilldown(postgres, workspaceId, limit, offset);
    rows = result.rows;
    queryLimit = result.limit;
    queryOffset = result.offset;
    fallback = true;
  }

  return {
    key: 'priority-leads-needing-action',
    objectType: widget.objectType,
    columns: [
      'firstname', 'lastname', 'email', 'phone', 'company', 'country',
      'hubspot_owner_id', 'hs_lead_status', 'notes_last_contacted'
    ],
    limit: queryLimit,
    offset: queryOffset,
    fallback,
    hasMore: rows.length === queryLimit,
    results: rows.map((row) => ({
      id: row.record_id,
      properties: row.properties ?? {},
      hubspotCreatedAt: row.hubspot_created_at,
      hubspotUpdatedAt: row.hubspot_updated_at,
      syncedAt: row.synced_at
    }))
  };
}

export function registerAnalyticsRoutes(app, { postgres, requireAdmin, requireWorkspace }) {
  app.get('/api/v1/workspaces/:workspaceId/analytics/sdr', { preHandler: requireAdmin }, async (request) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    return {
      workspace,
      dashboard: await buildSdrDashboard(postgres, workspace.id)
    };
  });

  app.get('/api/v1/workspaces/:workspaceId/analytics/sdr/metrics/:metricKey', { preHandler: requireAdmin }, async (request) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    return {
      workspaceId: workspace.id,
      metric: await getSdrMetric(postgres, workspace.id, String(request.params.metricKey ?? ''))
    };
  });

  app.get('/api/v1/workspaces/:workspaceId/analytics/sdr/drilldowns/priority-leads-needing-action', { preHandler: requireAdmin }, async (request) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    return {
      workspaceId: workspace.id,
      drilldown: await getPriorityLeadDrilldown(postgres, workspace.id, {
        limit: request.query?.limit,
        offset: request.query?.offset
      })
    };
  });
}
