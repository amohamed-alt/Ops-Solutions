import {
  buildRevenueReportingPack as buildCoreRevenueReportingPack,
  getRevenueDrilldown,
  normalizeReportingFilters
} from './agreed-reporting-core.js';

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

function countrySql(alias) {
  return `COALESCE(
    NULLIF(${alias}.properties->>'country', ''),
    NULLIF(${alias}.properties->>'hs_country_region_code', ''),
    'Unknown'
  )`;
}

function leadSourceSql(alias) {
  return `COALESCE(
    NULLIF(${alias}.properties->>'hs_analytics_source', ''),
    NULLIF(${alias}.properties->>'lead_source', ''),
    NULLIF(${alias}.properties->>'original_source', ''),
    'Unknown'
  )`;
}

function normalizedMappedValueSql(alias, propertyParameter, mappingParameter) {
  const raw = `NULLIF(jsonb_extract_path_text(${alias}.properties, $${propertyParameter}::text), '')`;
  return `COALESCE(($${mappingParameter}::jsonb)->>${raw}, ${raw}, 'Unknown')`;
}

function mixedContactDimensions(alias = 'r') {
  return `
    AND (
      ($5::text IS NULL AND $8::text IS NULL)
      OR EXISTS (
        SELECT 1
        FROM crm_record_associations ca
        JOIN crm_records contact_record
          ON contact_record.workspace_id = ca.workspace_id
         AND contact_record.object_type = 'contacts'
         AND contact_record.record_id = CASE
           WHEN ca.from_object_type = 'contacts' THEN ca.from_record_id
           ELSE ca.to_record_id
         END
         AND contact_record.archived = FALSE
        WHERE ca.workspace_id = $1
          AND (
            (ca.from_object_type = ${alias}.object_type AND ca.from_record_id = ${alias}.record_id AND ca.to_object_type = 'contacts')
            OR
            (ca.to_object_type = ${alias}.object_type AND ca.to_record_id = ${alias}.record_id AND ca.from_object_type = 'contacts')
          )
          AND ($5::text IS NULL OR ${countrySql('contact_record')} = $5)
          AND ($8::text IS NULL OR ${leadSourceSql('contact_record')} = $8)
      )
    )`;
}

function mixedDealDimensions(alias = 'r') {
  return `
    AND (
      ($6::text IS NULL AND $7::text IS NULL)
      OR EXISTS (
        SELECT 1
        FROM crm_record_associations da
        JOIN crm_records deal_record
          ON deal_record.workspace_id = da.workspace_id
         AND deal_record.object_type = 'deals'
         AND deal_record.record_id = CASE
           WHEN da.from_object_type = 'deals' THEN da.from_record_id
           ELSE da.to_record_id
         END
         AND deal_record.archived = FALSE
        WHERE da.workspace_id = $1
          AND (
            (da.from_object_type = ${alias}.object_type AND da.from_record_id = ${alias}.record_id AND da.to_object_type = 'deals')
            OR
            (da.to_object_type = ${alias}.object_type AND da.to_record_id = ${alias}.record_id AND da.from_object_type = 'deals')
          )
          AND ($6::text IS NULL OR NULLIF(deal_record.properties->>'pipeline', '') = $6)
          AND ($7::text IS NULL OR NULLIF(deal_record.properties->>'dealstage', '') = $7)
      )
    )`;
}

function filterValues(workspaceId, filters) {
  return [
    workspaceId,
    filters.from,
    filters.to,
    filters.ownerId,
    filters.country,
    filters.pipelineId,
    filters.stageId,
    filters.leadSource
  ];
}

function previousDayFilters(filters) {
  const end = new Date(`${filters.to}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const day = end.toISOString().slice(0, 10);
  return { ...filters, from: day, to: day, days: 1 };
}

async function loadOutcomeMappings(postgres, workspaceId) {
  try {
    const result = await postgres.query(
      `SELECT semantic_key, property_name, value_mapping
       FROM property_mappings
       WHERE workspace_id = $1
         AND ((semantic_key = 'call_outcome' AND object_type = 'calls')
           OR (semantic_key = 'meeting_outcome' AND object_type = 'meetings'))`,
      [workspaceId]
    );
    return Object.fromEntries(result.rows.map((row) => [row.semantic_key, {
      propertyName: row.property_name,
      valueMapping: row.value_mapping ?? {}
    }]));
  } catch (error) {
    if (error?.code === '42P01') return {};
    throw error;
  }
}

async function executeActivityReport(postgres, workspaceId, filters, mappings) {
  const callOutcome = mappings.call_outcome ?? { propertyName: 'hs_call_disposition', valueMapping: {} };
  const meetingOutcome = mappings.meeting_outcome ?? { propertyName: 'hs_meeting_outcome', valueMapping: {} };
  const values = [
    ...filterValues(workspaceId, filters),
    callOutcome.propertyName,
    JSON.stringify(callOutcome.valueMapping ?? {}),
    meetingOutcome.propertyName,
    JSON.stringify(meetingOutcome.valueMapping ?? {})
  ];
  const callValue = normalizedMappedValueSql('r', 9, 10);
  const meetingValue = normalizedMappedValueSql('r', 11, 12);
  const result = await postgres.query(
    `SELECT
       COUNT(*) FILTER (WHERE r.object_type = 'calls')::bigint AS calls,
       COUNT(*) FILTER (
         WHERE r.object_type = 'calls'
           AND (
             r.properties->>'hs_call_disposition' = 'f240bbac-87c9-4f6e-bf70-924b57d47db7'
             OR LOWER(${callValue}) ~ '(connected|answered|spoke|reached|successful)'
           )
       )::bigint AS connected_calls,
       COUNT(*) FILTER (WHERE r.object_type = 'meetings')::bigint AS meetings_booked,
       COUNT(*) FILTER (
         WHERE r.object_type = 'meetings'
           AND LOWER(${meetingValue}) ~ '(completed|held|attended|finished)'
       )::bigint AS meetings_completed,
       COUNT(*) FILTER (
         WHERE r.object_type = 'meetings'
           AND LOWER(${meetingValue}) ~ '(no[ _-]?show|did not attend|missed)'
       )::bigint AS no_show_meetings,
       COUNT(*) FILTER (WHERE r.object_type = 'tasks')::bigint AS tasks,
       COUNT(*) FILTER (
         WHERE r.object_type = 'tasks'
           AND UPPER(COALESCE(r.properties->>'hs_task_status', '')) IN ('COMPLETED','DONE','CLOSED')
       )::bigint AS completed_tasks
     FROM crm_records r
     WHERE r.workspace_id = $1
       AND r.object_type IN ('calls','meetings','tasks')
       AND r.archived = FALSE
       AND $2::date IS NOT NULL
       AND $3::date IS NOT NULL
       AND ${activityTimestampSql('r')} >= $2::date
       AND ${activityTimestampSql('r')} < ($3::date + INTERVAL '1 day')
       AND ($4::text IS NULL OR ${activityOwnerSql('r')} = $4)
       ${mixedContactDimensions('r')}
       ${mixedDealDimensions('r')}`,
    values
  );
  const row = result.rows[0] ?? {};
  const calls = numeric(row.calls);
  const connectedCalls = numeric(row.connected_calls);
  const meetingsBooked = numeric(row.meetings_booked);
  const meetingsCompleted = numeric(row.meetings_completed);
  const noShowMeetings = numeric(row.no_show_meetings);
  const tasks = numeric(row.tasks);
  const completedTasks = numeric(row.completed_tasks);
  return {
    calls,
    connectedCalls,
    connectionRate: calls > 0 ? connectedCalls / calls * 100 : 0,
    meetingsBooked,
    meetingsCompleted,
    meetingCompletionRate: meetingsBooked > 0 ? meetingsCompleted / meetingsBooked * 100 : 0,
    noShowMeetings,
    noShowRate: meetingsBooked > 0 ? noShowMeetings / meetingsBooked * 100 : 0,
    tasks,
    completedTasks,
    taskCompletionRate: tasks > 0 ? completedTasks / tasks * 100 : 0
  };
}

export async function buildRevenueReportingPack(postgres, workspaceId, rawFilters = {}) {
  const report = await buildCoreRevenueReportingPack(postgres, workspaceId, rawFilters);
  const mappings = await loadOutcomeMappings(postgres, workspaceId);
  const [execution, yesterday] = await Promise.all([
    executeActivityReport(postgres, workspaceId, report.filters, mappings),
    executeActivityReport(postgres, workspaceId, previousDayFilters(report.filters), mappings)
  ]);
  return {
    ...report,
    operatingReports: {
      ...report.operatingReports,
      execution: { ...report.operatingReports.execution, ...execution },
      yesterday
    }
  };
}

export function registerRevenueReportingRoutes(app, { postgres, requireAdmin, requireWorkspace }) {
  app.get('/api/v1/workspaces/:workspaceId/analytics/revenue', { preHandler: requireAdmin }, async (request) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    return {
      workspace,
      report: await buildRevenueReportingPack(postgres, workspace.id, request.query ?? {})
    };
  });

  app.get('/api/v1/workspaces/:workspaceId/analytics/revenue/drilldowns/:reportKey', { preHandler: requireAdmin }, async (request) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    return {
      workspaceId: workspace.id,
      drilldown: await getRevenueDrilldown(
        postgres,
        workspace.id,
        String(request.params.reportKey ?? ''),
        request.query ?? {}
      )
    };
  });
}

export { getRevenueDrilldown, normalizeReportingFilters };
