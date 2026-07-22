const REPORT_KEYS = new Set([
  'untouched-contacts',
  'stale-contacts',
  'missing-owner-contacts',
  'overdue-tasks',
  'no-next-activity-deals',
  'overdue-close-deals',
  'open-deals',
  'won-deals',
  'calls',
  'meetings'
]);

const OBJECT_COLUMNS = Object.freeze({
  contacts: ['firstname', 'lastname', 'email', 'phone', 'mobilephone', 'company', 'country', 'hubspot_owner_id', 'hs_lead_status', 'lifecyclestage', 'notes_last_contacted'],
  deals: ['dealname', 'amount', 'pipeline', 'dealstage', 'closedate', 'hubspot_owner_id', 'hs_next_activity_date', 'hs_is_closed', 'hs_is_closed_won'],
  tasks: ['hs_task_subject', 'hs_task_status', 'hs_task_priority', 'hs_timestamp', 'hubspot_owner_id', 'hs_activity_assigned_to_user_id'],
  calls: ['hs_call_title', 'hs_call_status', 'hs_call_disposition', 'hs_timestamp', 'hubspot_owner_id', 'hs_activity_assigned_to_user_id'],
  meetings: ['hs_meeting_title', 'hs_meeting_outcome', 'hs_meeting_start_time', 'hs_timestamp', 'hubspot_owner_id', 'hs_activity_assigned_to_user_id']
});

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanDimension(value, maxLength = 160) {
  const result = String(value ?? '').trim();
  return result ? result.slice(0, maxLength) : null;
}

function isoDate(value) {
  const result = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) return null;
  const parsed = new Date(`${result}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : result;
}

function dateShift(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function inclusiveDays(from, to) {
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  const end = new Date(`${to}T00:00:00.000Z`).getTime();
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function normalizeReportingFilters(query = {}, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const to = isoDate(query.to) ?? today;
  const from = isoDate(query.from) ?? dateShift(to, -29);
  const days = inclusiveDays(from, to);
  if (days < 1) {
    const error = new Error('The reporting start date must be on or before the end date.');
    error.statusCode = 400;
    error.category = 'INVALID_REPORTING_RANGE';
    throw error;
  }
  if (days > 366) {
    const error = new Error('The reporting range cannot exceed 366 days.');
    error.statusCode = 400;
    error.category = 'REPORTING_RANGE_TOO_LARGE';
    throw error;
  }
  return {
    from,
    to,
    days,
    ownerId: cleanDimension(query.ownerId),
    country: cleanDimension(query.country),
    pipelineId: cleanDimension(query.pipelineId),
    stageId: cleanDimension(query.stageId),
    leadSource: cleanDimension(query.leadSource)
  };
}

function previousFilters(filters) {
  const previousTo = dateShift(filters.from, -1);
  const previousFrom = dateShift(previousTo, -(filters.days - 1));
  return { ...filters, from: previousFrom, to: previousTo };
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

function recordTimestampSql(alias, objectType) {
  return ['calls', 'meetings', 'tasks'].includes(objectType)
    ? activityTimestampSql(alias)
    : `COALESCE(${alias}.hubspot_created_at, ${alias}.synced_at)`;
}

function ownerSql(alias, objectType) {
  if (['calls', 'meetings', 'tasks'].includes(objectType)) {
    return `COALESCE(
      NULLIF(${alias}.properties->>'hubspot_owner_id', ''),
      NULLIF(${alias}.properties->>'hs_activity_assigned_to_user_id', ''),
      NULLIF(${alias}.properties->>'hs_created_by_user_id', ''),
      'Unassigned'
    )`;
  }
  return `COALESCE(NULLIF(${alias}.properties->>'hubspot_owner_id', ''), 'Unassigned')`;
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

function amountSql(alias = 'r') {
  return `CASE
    WHEN COALESCE(${alias}.properties->>'amount', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
      THEN (${alias}.properties->>'amount')::numeric
    ELSE 0
  END`;
}

function closedSql(alias = 'r') {
  return `LOWER(COALESCE(${alias}.properties->>'hs_is_closed', 'false')) IN ('true', '1')`;
}

function wonSql(alias = 'r') {
  return `LOWER(COALESCE(${alias}.properties->>'hs_is_closed_won', 'false')) IN ('true', '1')`;
}

function directContactDimensions(alias = 'r') {
  return `
    AND ($5::text IS NULL OR ${countrySql(alias)} = $5)
    AND ($8::text IS NULL OR ${leadSourceSql(alias)} = $8)`;
}

function contactAssociationDimensions(alias, objectType) {
  if (objectType === 'contacts') return directContactDimensions(alias);
  return `
    AND (
      ($5::text IS NULL AND $8::text IS NULL)
      OR EXISTS (
        SELECT 1
        FROM crm_record_associations ca
        JOIN crm_records contact_record
          ON contact_record.workspace_id = ca.workspace_id
         AND contact_record.object_type = 'contacts'
         AND contact_record.record_id = ca.to_record_id
         AND contact_record.archived = FALSE
        WHERE ca.workspace_id = $1
          AND ca.from_object_type = '${objectType}'
          AND ca.from_record_id = ${alias}.record_id
          AND ca.to_object_type = 'contacts'
          AND ($5::text IS NULL OR ${countrySql('contact_record')} = $5)
          AND ($8::text IS NULL OR ${leadSourceSql('contact_record')} = $8)
      )
    )`;
}

function mixedActivityContactDimensions(alias = 'r') {
  return `
    AND (
      ($5::text IS NULL AND $8::text IS NULL)
      OR EXISTS (
        SELECT 1
        FROM crm_record_associations ca
        JOIN crm_records contact_record
          ON contact_record.workspace_id = ca.workspace_id
         AND contact_record.object_type = 'contacts'
         AND contact_record.record_id = ca.to_record_id
         AND contact_record.archived = FALSE
        WHERE ca.workspace_id = $1
          AND ca.from_object_type = ${alias}.object_type
          AND ca.from_record_id = ${alias}.record_id
          AND ca.to_object_type = 'contacts'
          AND ($5::text IS NULL OR ${countrySql('contact_record')} = $5)
          AND ($8::text IS NULL OR ${leadSourceSql('contact_record')} = $8)
      )
    )`;
}

function dealAssociationDimensions(alias, objectType) {
  if (objectType === 'deals') {
    return `
      AND ($6::text IS NULL OR NULLIF(${alias}.properties->>'pipeline', '') = $6)
      AND ($7::text IS NULL OR NULLIF(${alias}.properties->>'dealstage', '') = $7)`;
  }
  if (objectType === 'contacts') {
    return `
      AND (
        ($6::text IS NULL AND $7::text IS NULL)
        OR EXISTS (
          SELECT 1
          FROM crm_record_associations da
          JOIN crm_records deal_record
            ON deal_record.workspace_id = da.workspace_id
           AND deal_record.object_type = 'deals'
           AND deal_record.record_id = da.from_record_id
           AND deal_record.archived = FALSE
          WHERE da.workspace_id = $1
            AND da.from_object_type = 'deals'
            AND da.to_object_type = 'contacts'
            AND da.to_record_id = ${alias}.record_id
            AND ($6::text IS NULL OR NULLIF(deal_record.properties->>'pipeline', '') = $6)
            AND ($7::text IS NULL OR NULLIF(deal_record.properties->>'dealstage', '') = $7)
        )
      )`;
  }
  return '';
}

function objectPredicate(objectType, alias = 'r', { period = true } = {}) {
  const timestamp = recordTimestampSql(alias, objectType);
  return `
    ${alias}.workspace_id = $1
    AND ${alias}.object_type = '${objectType}'
    AND ${alias}.archived = FALSE
    ${period ? `AND ${timestamp} >= $2::date AND ${timestamp} < ($3::date + INTERVAL '1 day')` : ''}
    AND ($4::text IS NULL OR ${ownerSql(alias, objectType)} = $4)
    ${contactAssociationDimensions(alias, objectType)}
    ${dealAssociationDimensions(alias, objectType)}`;
}

function delta(current, previous) {
  const currentValue = numeric(current);
  const previousValue = numeric(previous);
  if (previousValue === 0) return currentValue === 0 ? 0 : null;
  return ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
}

async function overviewMetrics(postgres, workspaceId, filters) {
  const values = filterValues(workspaceId, filters);
  const [contacts, activities, deals, tasks] = await Promise.all([
    postgres.query(
      `SELECT
         COUNT(*)::bigint AS portfolio_contacts,
         COUNT(*) FILTER (
           WHERE COALESCE(r.hubspot_created_at, r.synced_at) >= $2::date
             AND COALESCE(r.hubspot_created_at, r.synced_at) < ($3::date + INTERVAL '1 day')
         )::bigint AS new_contacts,
         COUNT(*) FILTER (WHERE NULLIF(r.properties->>'hubspot_owner_id', '') IS NULL)::bigint AS missing_owner
       FROM crm_records r
       WHERE ${objectPredicate('contacts', 'r', { period: false })}`,
      values
    ),
    postgres.query(
      `SELECT
         COUNT(*) FILTER (WHERE r.object_type = 'calls')::bigint AS calls,
         COUNT(*) FILTER (WHERE r.object_type = 'meetings')::bigint AS meetings,
         COUNT(*) FILTER (WHERE r.object_type = 'tasks')::bigint AS tasks,
         COUNT(*) FILTER (
           WHERE r.object_type = 'tasks'
             AND UPPER(COALESCE(r.properties->>'hs_task_status', '')) IN ('COMPLETED', 'DONE', 'CLOSED')
         )::bigint AS completed_tasks
       FROM crm_records r
       WHERE r.workspace_id = $1
         AND r.object_type IN ('calls', 'meetings', 'tasks')
         AND r.archived = FALSE
         AND ${activityTimestampSql('r')} >= $2::date
         AND ${activityTimestampSql('r')} < ($3::date + INTERVAL '1 day')
         AND ($4::text IS NULL OR ${ownerSql('r', 'calls')} = $4)
         ${mixedActivityContactDimensions('r')}`,
      values
    ),
    postgres.query(
      `SELECT
         COUNT(*) FILTER (WHERE NOT (${closedSql('r')}))::bigint AS open_deals,
         COALESCE(SUM(${amountSql('r')}) FILTER (WHERE NOT (${closedSql('r')})), 0)::numeric AS open_pipeline,
         COUNT(*) FILTER (
           WHERE ${wonSql('r')}
             AND COALESCE(${jsonTimestampSql('closedate', 'r')}, r.hubspot_updated_at, r.synced_at) >= $2::date
             AND COALESCE(${jsonTimestampSql('closedate', 'r')}, r.hubspot_updated_at, r.synced_at) < ($3::date + INTERVAL '1 day')
         )::bigint AS won_deals,
         COALESCE(SUM(${amountSql('r')}) FILTER (
           WHERE ${wonSql('r')}
             AND COALESCE(${jsonTimestampSql('closedate', 'r')}, r.hubspot_updated_at, r.synced_at) >= $2::date
             AND COALESCE(${jsonTimestampSql('closedate', 'r')}, r.hubspot_updated_at, r.synced_at) < ($3::date + INTERVAL '1 day')
         ), 0)::numeric AS won_revenue,
         COUNT(*) FILTER (
           WHERE NOT (${closedSql('r')})
             AND NULLIF(r.properties->>'hs_next_activity_date', '') IS NULL
         )::bigint AS no_next_activity,
         COUNT(*) FILTER (
           WHERE NOT (${closedSql('r')})
             AND ${jsonTimestampSql('closedate', 'r')} < CURRENT_DATE
         )::bigint AS overdue_close
       FROM crm_records r
       WHERE ${objectPredicate('deals', 'r', { period: false })}`,
      values
    ),
    postgres.query(
      `SELECT
         COUNT(*) FILTER (
           WHERE UPPER(COALESCE(r.properties->>'hs_task_status', '')) NOT IN ('COMPLETED', 'DONE', 'CLOSED')
         )::bigint AS open_tasks,
         COUNT(*) FILTER (
           WHERE UPPER(COALESCE(r.properties->>'hs_task_status', '')) NOT IN ('COMPLETED', 'DONE', 'CLOSED')
             AND COALESCE(${jsonTimestampSql('hs_timestamp', 'r')}, r.hubspot_created_at)::date = CURRENT_DATE
         )::bigint AS tasks_due_today,
         COUNT(*) FILTER (
           WHERE UPPER(COALESCE(r.properties->>'hs_task_status', '')) NOT IN ('COMPLETED', 'DONE', 'CLOSED')
             AND COALESCE(${jsonTimestampSql('hs_timestamp', 'r')}, r.hubspot_created_at)::date < CURRENT_DATE
         )::bigint AS overdue_tasks
       FROM crm_records r
       WHERE ${objectPredicate('tasks', 'r', { period: false })}`,
      values
    )
  ]);

  const contactRow = contacts.rows[0] ?? {};
  const activityRow = activities.rows[0] ?? {};
  const dealRow = deals.rows[0] ?? {};
  const taskRow = tasks.rows[0] ?? {};
  const calls = numeric(activityRow.calls);
  const meetings = numeric(activityRow.meetings);
  const openDeals = numeric(dealRow.open_deals);
  const noNextActivity = numeric(dealRow.no_next_activity);
  const overdueClose = numeric(dealRow.overdue_close);

  return {
    portfolioContacts: numeric(contactRow.portfolio_contacts),
    newContacts: numeric(contactRow.new_contacts),
    missingOwnerContacts: numeric(contactRow.missing_owner),
    calls,
    meetings,
    meetingRate: calls > 0 ? (meetings / calls) * 100 : 0,
    tasks: numeric(activityRow.tasks),
    completedTasks: numeric(activityRow.completed_tasks),
    openTasks: numeric(taskRow.open_tasks),
    tasksDueToday: numeric(taskRow.tasks_due_today),
    overdueTasks: numeric(taskRow.overdue_tasks),
    openDeals,
    openPipeline: numeric(dealRow.open_pipeline),
    wonDeals: numeric(dealRow.won_deals),
    wonRevenue: numeric(dealRow.won_revenue),
    noNextActivityDeals: noNextActivity,
    overdueCloseDeals: overdueClose,
    dealsAtRisk: Math.min(openDeals, noNextActivity + overdueClose)
  };
}

async function activityTrend(postgres, workspaceId, filters) {
  const values = filterValues(workspaceId, filters);
  const result = await postgres.query(
    `WITH dates AS (
       SELECT generate_series($2::date, $3::date, INTERVAL '1 day')::date AS day
     ), activity AS (
       SELECT
         date_trunc('day', ${activityTimestampSql('r')})::date AS day,
         COUNT(*) FILTER (WHERE r.object_type = 'calls')::int AS calls,
         COUNT(*) FILTER (WHERE r.object_type = 'meetings')::int AS meetings,
         COUNT(*) FILTER (WHERE r.object_type = 'tasks')::int AS tasks
       FROM crm_records r
       WHERE r.workspace_id = $1
         AND r.object_type IN ('calls', 'meetings', 'tasks')
         AND r.archived = FALSE
         AND ${activityTimestampSql('r')} >= $2::date
         AND ${activityTimestampSql('r')} < ($3::date + INTERVAL '1 day')
         AND ($4::text IS NULL OR ${ownerSql('r', 'calls')} = $4)
         ${mixedActivityContactDimensions('r')}
       GROUP BY 1
     )
     SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
            COALESCE(a.calls, 0)::int AS calls,
            COALESCE(a.meetings, 0)::int AS meetings,
            COALESCE(a.tasks, 0)::int AS tasks
     FROM dates d
     LEFT JOIN activity a ON a.day = d.day
     ORDER BY d.day`,
    values
  );
  return result.rows.map((row) => ({
    day: row.day,
    calls: numeric(row.calls),
    meetings: numeric(row.meetings),
    tasks: numeric(row.tasks)
  }));
}

async function pipelineByStage(postgres, workspaceId, filters) {
  const values = filterValues(workspaceId, filters);
  const result = await postgres.query(
    `SELECT
       COALESCE(NULLIF(r.properties->>'pipeline', ''), 'unknown') AS pipeline_id,
       COALESCE(NULLIF(r.properties->>'dealstage', ''), 'unknown') AS stage_id,
       COALESCE(p.label, NULLIF(r.properties->>'pipeline', ''), 'Unknown pipeline') AS pipeline_label,
       COALESCE(s.label, NULLIF(r.properties->>'dealstage', ''), 'Unknown stage') AS stage_label,
       COUNT(*)::bigint AS deals,
       COALESCE(SUM(${amountSql('r')}), 0)::numeric AS amount
     FROM crm_records r
     LEFT JOIN crm_pipelines p
       ON p.workspace_id = r.workspace_id
      AND p.object_type = 'deals'
      AND p.pipeline_id = r.properties->>'pipeline'
     LEFT JOIN crm_pipeline_stages s
       ON s.workspace_id = r.workspace_id
      AND s.object_type = 'deals'
      AND s.pipeline_id = r.properties->>'pipeline'
      AND s.stage_id = r.properties->>'dealstage'
     WHERE ${objectPredicate('deals', 'r', { period: false })}
       AND NOT (${closedSql('r')})
     GROUP BY 1,2,3,4,COALESCE(s.display_order, 9999)
     ORDER BY pipeline_label, COALESCE(s.display_order, 9999), amount DESC`,
    values
  );
  return result.rows.map((row) => ({
    pipelineId: row.pipeline_id,
    stageId: row.stage_id,
    pipelineLabel: row.pipeline_label,
    stageLabel: row.stage_label,
    deals: numeric(row.deals),
    amount: numeric(row.amount)
  }));
}

async function leadSourcePerformance(postgres, workspaceId, filters) {
  const values = filterValues(workspaceId, filters);
  const result = await postgres.query(
    `WITH contacts AS (
       SELECT r.record_id, r.properties, ${leadSourceSql('r')} AS source
       FROM crm_records r
       WHERE ${objectPredicate('contacts', 'r', { period: false })}
     ), deal_links AS (
       SELECT
         a.to_record_id AS contact_id,
         BOOL_OR(NOT (${closedSql('d')})) AS has_open_deal,
         BOOL_OR(${wonSql('d')}) AS has_won_deal
       FROM crm_record_associations a
       JOIN crm_records d
         ON d.workspace_id = a.workspace_id
        AND d.object_type = 'deals'
        AND d.record_id = a.from_record_id
        AND d.archived = FALSE
       WHERE a.workspace_id = $1
         AND a.from_object_type = 'deals'
         AND a.to_object_type = 'contacts'
         AND ($6::text IS NULL OR NULLIF(d.properties->>'pipeline', '') = $6)
         AND ($7::text IS NULL OR NULLIF(d.properties->>'dealstage', '') = $7)
       GROUP BY a.to_record_id
     )
     SELECT
       c.source AS key,
       COUNT(*)::bigint AS contacts,
       COUNT(*) FILTER (WHERE NULLIF(c.properties->>'notes_last_contacted', '') IS NOT NULL)::bigint AS contacted,
       COUNT(*) FILTER (WHERE COALESCE(dl.has_open_deal, FALSE))::bigint AS opportunities,
       COUNT(*) FILTER (WHERE COALESCE(dl.has_won_deal, FALSE))::bigint AS won
     FROM contacts c
     LEFT JOIN deal_links dl ON dl.contact_id = c.record_id
     GROUP BY c.source
     ORDER BY contacts DESC, c.source
     LIMIT 12`,
    values
  );
  return result.rows.map((row) => {
    const contacts = numeric(row.contacts);
    const won = numeric(row.won);
    return {
      key: row.key || 'Unknown',
      contacts,
      contacted: numeric(row.contacted),
      opportunities: numeric(row.opportunities),
      won,
      winRate: contacts > 0 ? (won / contacts) * 100 : 0
    };
  });
}

async function countryDistribution(postgres, workspaceId, filters) {
  const values = filterValues(workspaceId, filters);
  const result = await postgres.query(
    `SELECT ${countrySql('r')} AS key, COUNT(*)::bigint AS value
     FROM crm_records r
     WHERE ${objectPredicate('contacts', 'r', { period: false })}
     GROUP BY 1
     ORDER BY value DESC, key
     LIMIT 12`,
    values
  );
  return result.rows.map((row) => ({ key: row.key || 'Unknown', value: numeric(row.value) }));
}

async function ownerPerformance(postgres, workspaceId, filters) {
  const values = filterValues(workspaceId, filters);
  const result = await postgres.query(
    `WITH activity AS (
       SELECT ${ownerSql('r', 'calls')} AS owner_key,
              COUNT(*) FILTER (WHERE r.object_type = 'calls')::bigint AS calls,
              COUNT(*) FILTER (WHERE r.object_type = 'meetings')::bigint AS meetings,
              COUNT(*) FILTER (WHERE r.object_type = 'tasks')::bigint AS tasks
       FROM crm_records r
       WHERE r.workspace_id = $1
         AND r.object_type IN ('calls','meetings','tasks')
         AND r.archived = FALSE
         AND ${activityTimestampSql('r')} >= $2::date
         AND ${activityTimestampSql('r')} < ($3::date + INTERVAL '1 day')
         AND ($4::text IS NULL OR ${ownerSql('r', 'calls')} = $4)
         ${mixedActivityContactDimensions('r')}
       GROUP BY 1
     ), deals AS (
       SELECT ${ownerSql('r', 'deals')} AS owner_key,
              COUNT(*) FILTER (WHERE NOT (${closedSql('r')}))::bigint AS open_deals,
              COALESCE(SUM(${amountSql('r')}) FILTER (WHERE NOT (${closedSql('r')})),0)::numeric AS open_pipeline,
              COALESCE(SUM(${amountSql('r')}) FILTER (
                WHERE ${wonSql('r')}
                  AND COALESCE(${jsonTimestampSql('closedate', 'r')}, r.hubspot_updated_at, r.synced_at) >= $2::date
                  AND COALESCE(${jsonTimestampSql('closedate', 'r')}, r.hubspot_updated_at, r.synced_at) < ($3::date + INTERVAL '1 day')
              ),0)::numeric AS won_revenue
       FROM crm_records r
       WHERE ${objectPredicate('deals', 'r', { period: false })}
       GROUP BY 1
     ), keys AS (
       SELECT owner_key FROM activity UNION SELECT owner_key FROM deals
     )
     SELECT
       k.owner_key,
       COALESCE(NULLIF(CONCAT_WS(' ', o.first_name, o.last_name), ''), o.email,
         CASE WHEN k.owner_key = 'Unassigned' THEN 'Unassigned' ELSE CONCAT('Owner ', k.owner_key) END) AS owner_name,
       o.email,
       COALESCE(a.calls,0)::bigint AS calls,
       COALESCE(a.meetings,0)::bigint AS meetings,
       COALESCE(a.tasks,0)::bigint AS tasks,
       COALESCE(d.open_deals,0)::bigint AS open_deals,
       COALESCE(d.open_pipeline,0)::numeric AS open_pipeline,
       COALESCE(d.won_revenue,0)::numeric AS won_revenue
     FROM keys k
     LEFT JOIN activity a ON a.owner_key = k.owner_key
     LEFT JOIN deals d ON d.owner_key = k.owner_key
     LEFT JOIN crm_owners o
       ON o.workspace_id = $1
      AND (o.owner_id = k.owner_key OR o.user_id::text = k.owner_key)
     ORDER BY calls DESC, meetings DESC, open_pipeline DESC
     LIMIT 50`,
    values
  );
  return result.rows.map((row) => ({
    ownerId: row.owner_key,
    ownerName: row.owner_name,
    email: row.email ?? null,
    calls: numeric(row.calls),
    meetings: numeric(row.meetings),
    tasks: numeric(row.tasks),
    openDeals: numeric(row.open_deals),
    openPipeline: numeric(row.open_pipeline),
    wonRevenue: numeric(row.won_revenue),
    meetingRate: numeric(row.calls) > 0 ? (numeric(row.meetings) / numeric(row.calls)) * 100 : 0
  }));
}

async function outcomeDistributions(postgres, workspaceId, filters) {
  const values = filterValues(workspaceId, filters);
  const specs = [
    ['calls', `COALESCE(NULLIF(r.properties->>'hs_call_disposition',''), NULLIF(r.properties->>'hs_call_status',''), 'Unknown')`],
    ['meetings', `COALESCE(NULLIF(r.properties->>'hs_meeting_outcome',''), 'Unknown')`],
    ['tasks', `COALESCE(NULLIF(r.properties->>'hs_task_status',''), 'Unknown')`]
  ];
  const rows = await Promise.all(specs.map(async ([objectType, expression]) => {
    const result = await postgres.query(
      `SELECT ${expression} AS key, COUNT(*)::bigint AS value
       FROM crm_records r
       WHERE ${objectPredicate(objectType, 'r', { period: true })}
       GROUP BY 1
       ORDER BY value DESC, key
       LIMIT 10`,
      values
    );
    return [objectType, result.rows.map((row) => ({ key: row.key || 'Unknown', value: numeric(row.value) }))];
  }));
  return Object.fromEntries(rows);
}

async function dataQuality(postgres, workspaceId, filters) {
  const values = filterValues(workspaceId, filters);
  const result = await postgres.query(
    `SELECT
       COUNT(*)::bigint AS total,
       COUNT(*) FILTER (WHERE NULLIF(r.properties->>'email','') IS NOT NULL)::bigint AS email,
       COUNT(*) FILTER (WHERE COALESCE(NULLIF(r.properties->>'phone',''),NULLIF(r.properties->>'mobilephone','')) IS NOT NULL)::bigint AS phone,
       COUNT(*) FILTER (WHERE NULLIF(r.properties->>'company','') IS NOT NULL)::bigint AS company,
       COUNT(*) FILTER (WHERE NULLIF(r.properties->>'hubspot_owner_id','') IS NOT NULL)::bigint AS owner,
       COUNT(*) FILTER (WHERE ${countrySql('r')} <> 'Unknown')::bigint AS country,
       COUNT(*) FILTER (WHERE NULLIF(r.properties->>'jobtitle','') IS NOT NULL)::bigint AS job_title
     FROM crm_records r
     WHERE ${objectPredicate('contacts', 'r', { period: false })}`,
    values
  );
  const row = result.rows[0] ?? {};
  const total = numeric(row.total);
  const fields = ['email', 'phone', 'company', 'owner', 'country', 'job_title'].map((key) => ({
    key,
    complete: numeric(row[key]),
    missing: Math.max(0, total - numeric(row[key])),
    percentage: total > 0 ? (numeric(row[key]) / total) * 100 : 100
  }));
  return {
    totalContacts: total,
    score: fields.length ? fields.reduce((sum, field) => sum + field.percentage, 0) / fields.length : 100,
    fields
  };
}

async function attentionSnapshot(postgres, workspaceId, filters) {
  const values = filterValues(workspaceId, filters);
  const [contacts, tasks, deals] = await Promise.all([
    postgres.query(
      `SELECT
         COUNT(*) FILTER (
           WHERE NULLIF(r.properties->>'notes_last_contacted','') IS NULL
             AND COALESCE(r.hubspot_created_at,r.synced_at) < NOW() - INTERVAL '2 days'
         )::bigint AS untouched,
         COUNT(*) FILTER (
           WHERE NULLIF(r.properties->>'notes_last_contacted','') IS NOT NULL
             AND ${jsonTimestampSql('notes_last_contacted','r')} < NOW() - INTERVAL '21 days'
         )::bigint AS stale,
         COUNT(*) FILTER (WHERE NULLIF(r.properties->>'hubspot_owner_id','') IS NULL)::bigint AS missing_owner
       FROM crm_records r
       WHERE ${objectPredicate('contacts', 'r', { period: false })}`,
      values
    ),
    postgres.query(
      `SELECT COUNT(*) FILTER (
         WHERE UPPER(COALESCE(r.properties->>'hs_task_status','')) NOT IN ('COMPLETED','DONE','CLOSED')
           AND COALESCE(${jsonTimestampSql('hs_timestamp','r')},r.hubspot_created_at)::date < CURRENT_DATE
       )::bigint AS overdue_tasks
       FROM crm_records r
       WHERE ${objectPredicate('tasks', 'r', { period: false })}`,
      values
    ),
    postgres.query(
      `SELECT
         COUNT(*) FILTER (
           WHERE NOT (${closedSql('r')})
             AND NULLIF(r.properties->>'hs_next_activity_date','') IS NULL
         )::bigint AS no_next_activity,
         COUNT(*) FILTER (
           WHERE NOT (${closedSql('r')})
             AND ${jsonTimestampSql('closedate','r')} < CURRENT_DATE
         )::bigint AS overdue_close,
         COUNT(*) FILTER (
           WHERE NOT (${closedSql('r')})
             AND ${jsonTimestampSql('closedate','r')} >= CURRENT_DATE
             AND ${jsonTimestampSql('closedate','r')} < CURRENT_DATE + INTERVAL '14 days'
         )::bigint AS closing_soon
       FROM crm_records r
       WHERE ${objectPredicate('deals', 'r', { period: false })}`,
      values
    )
  ]);
  const contactRow = contacts.rows[0] ?? {};
  const taskRow = tasks.rows[0] ?? {};
  const dealRow = deals.rows[0] ?? {};
  return {
    untouchedContacts: numeric(contactRow.untouched),
    staleContacts: numeric(contactRow.stale),
    missingOwnerContacts: numeric(contactRow.missing_owner),
    overdueTasks: numeric(taskRow.overdue_tasks),
    noNextActivityDeals: numeric(dealRow.no_next_activity),
    overdueCloseDeals: numeric(dealRow.overdue_close),
    dealsClosingSoon: numeric(dealRow.closing_soon)
  };
}

async function filterOptions(postgres, workspaceId) {
  const [owners, countries, sources, pipelines, stages] = await Promise.all([
    postgres.query(
      `SELECT owner_id AS id,
              COALESCE(NULLIF(CONCAT_WS(' ',first_name,last_name),''),email,CONCAT('Owner ',owner_id)) AS label,
              email
       FROM crm_owners
       WHERE workspace_id = $1 AND archived = FALSE
       ORDER BY label`,
      [workspaceId]
    ),
    postgres.query(
      `SELECT ${countrySql('r')} AS value, COUNT(*)::bigint AS count
       FROM crm_records r
       WHERE r.workspace_id = $1 AND r.object_type = 'contacts' AND r.archived = FALSE
       GROUP BY 1 ORDER BY count DESC, value LIMIT 100`,
      [workspaceId]
    ),
    postgres.query(
      `SELECT ${leadSourceSql('r')} AS value, COUNT(*)::bigint AS count
       FROM crm_records r
       WHERE r.workspace_id = $1 AND r.object_type = 'contacts' AND r.archived = FALSE
       GROUP BY 1 ORDER BY count DESC, value LIMIT 100`,
      [workspaceId]
    ),
    postgres.query(
      `SELECT pipeline_id AS id, label
       FROM crm_pipelines
       WHERE workspace_id = $1 AND object_type = 'deals' AND archived = FALSE
       ORDER BY display_order NULLS LAST, label`,
      [workspaceId]
    ),
    postgres.query(
      `SELECT pipeline_id, stage_id AS id, label
       FROM crm_pipeline_stages
       WHERE workspace_id = $1 AND object_type = 'deals' AND archived = FALSE
       ORDER BY pipeline_id, display_order NULLS LAST, label`,
      [workspaceId]
    )
  ]);
  return {
    owners: owners.rows.map((row) => ({ id: String(row.id), label: row.label, email: row.email ?? null })),
    countries: countries.rows.map((row) => ({ value: row.value || 'Unknown', count: numeric(row.count) })),
    leadSources: sources.rows.map((row) => ({ value: row.value || 'Unknown', count: numeric(row.count) })),
    pipelines: pipelines.rows.map((row) => ({ id: String(row.id), label: row.label })),
    stages: stages.rows.map((row) => ({ pipelineId: String(row.pipeline_id), id: String(row.id), label: row.label }))
  };
}

function metricComparisons(current, previous) {
  const keys = ['newContacts', 'calls', 'meetings', 'tasks', 'completedTasks', 'wonDeals', 'wonRevenue'];
  return Object.fromEntries(keys.map((key) => [key, {
    current: numeric(current[key]),
    previous: numeric(previous[key]),
    deltaPercent: delta(current[key], previous[key])
  }]));
}

export async function buildRevenueReportingPack(postgres, workspaceId, rawFilters = {}) {
  const filters = normalizeReportingFilters(rawFilters);
  const previous = previousFilters(filters);
  const [overview, previousOverview, trend, pipeline, sources, countries, owners, outcomes, quality, attention, options] = await Promise.all([
    overviewMetrics(postgres, workspaceId, filters),
    overviewMetrics(postgres, workspaceId, previous),
    activityTrend(postgres, workspaceId, filters),
    pipelineByStage(postgres, workspaceId, filters),
    leadSourcePerformance(postgres, workspaceId, filters),
    countryDistribution(postgres, workspaceId, filters),
    ownerPerformance(postgres, workspaceId, filters),
    outcomeDistributions(postgres, workspaceId, filters),
    dataQuality(postgres, workspaceId, filters),
    attentionSnapshot(postgres, workspaceId, filters),
    filterOptions(postgres, workspaceId)
  ]);

  return {
    generatedAt: new Date().toISOString(),
    filters,
    comparisonPeriod: { from: previous.from, to: previous.to },
    filterOptions: options,
    overview,
    comparisons: metricComparisons(overview, previousOverview),
    activityTrend: trend,
    pipelineByStage: pipeline,
    leadSourcePerformance: sources,
    countryDistribution: countries,
    ownerPerformance: owners,
    outcomes,
    dataQuality: quality,
    attention,
    drilldowns: [...REPORT_KEYS]
  };
}

function drilldownDefinition(reportKey) {
  const definitions = {
    'untouched-contacts': {
      objectType: 'contacts',
      period: false,
      condition: `NULLIF(r.properties->>'notes_last_contacted','') IS NULL
        AND COALESCE(r.hubspot_created_at,r.synced_at) < NOW() - INTERVAL '2 days'`,
      orderBy: 'COALESCE(r.hubspot_created_at,r.synced_at) ASC'
    },
    'stale-contacts': {
      objectType: 'contacts',
      period: false,
      condition: `NULLIF(r.properties->>'notes_last_contacted','') IS NOT NULL
        AND ${jsonTimestampSql('notes_last_contacted','r')} < NOW() - INTERVAL '21 days'`,
      orderBy: `${jsonTimestampSql('notes_last_contacted','r')} ASC`
    },
    'missing-owner-contacts': {
      objectType: 'contacts',
      period: false,
      condition: `NULLIF(r.properties->>'hubspot_owner_id','') IS NULL`,
      orderBy: 'COALESCE(r.hubspot_created_at,r.synced_at) DESC'
    },
    'overdue-tasks': {
      objectType: 'tasks',
      period: false,
      condition: `UPPER(COALESCE(r.properties->>'hs_task_status','')) NOT IN ('COMPLETED','DONE','CLOSED')
        AND COALESCE(${jsonTimestampSql('hs_timestamp','r')},r.hubspot_created_at)::date < CURRENT_DATE`,
      orderBy: `COALESCE(${jsonTimestampSql('hs_timestamp','r')},r.hubspot_created_at) ASC`
    },
    'no-next-activity-deals': {
      objectType: 'deals',
      period: false,
      condition: `NOT (${closedSql('r')}) AND NULLIF(r.properties->>'hs_next_activity_date','') IS NULL`,
      orderBy: `${amountSql('r')} DESC`
    },
    'overdue-close-deals': {
      objectType: 'deals',
      period: false,
      condition: `NOT (${closedSql('r')}) AND ${jsonTimestampSql('closedate','r')} < CURRENT_DATE`,
      orderBy: `${jsonTimestampSql('closedate','r')} ASC`
    },
    'open-deals': {
      objectType: 'deals',
      period: false,
      condition: `NOT (${closedSql('r')})`,
      orderBy: `${amountSql('r')} DESC`
    },
    'won-deals': {
      objectType: 'deals',
      period: false,
      condition: `${wonSql('r')}
        AND COALESCE(${jsonTimestampSql('closedate','r')},r.hubspot_updated_at,r.synced_at) >= $2::date
        AND COALESCE(${jsonTimestampSql('closedate','r')},r.hubspot_updated_at,r.synced_at) < ($3::date + INTERVAL '1 day')`,
      orderBy: `COALESCE(${jsonTimestampSql('closedate','r')},r.hubspot_updated_at,r.synced_at) DESC`
    },
    calls: { objectType: 'calls', period: true, condition: 'TRUE', orderBy: `${activityTimestampSql('r')} DESC` },
    meetings: { objectType: 'meetings', period: true, condition: 'TRUE', orderBy: `${activityTimestampSql('r')} DESC` }
  };
  return definitions[reportKey] ?? null;
}

export async function getRevenueDrilldown(postgres, workspaceId, reportKey, rawFilters = {}) {
  if (!REPORT_KEYS.has(reportKey)) {
    const error = new Error(`Unknown revenue drilldown: ${reportKey}`);
    error.statusCode = 404;
    error.category = 'REPORT_NOT_FOUND';
    throw error;
  }
  const filters = normalizeReportingFilters(rawFilters);
  const limit = Math.max(1, Math.min(200, Number(rawFilters.limit) || 50));
  const offset = Math.max(0, Number(rawFilters.offset) || 0);
  const definition = drilldownDefinition(reportKey);
  const values = [...filterValues(workspaceId, filters), limit + 1, offset];
  const result = await postgres.query(
    `SELECT r.record_id, r.properties, r.hubspot_created_at, r.hubspot_updated_at, r.synced_at
     FROM crm_records r
     WHERE ${objectPredicate(definition.objectType, 'r', { period: definition.period })}
       AND (${definition.condition})
     ORDER BY ${definition.orderBy}, r.record_id
     LIMIT $9 OFFSET $10`,
    values
  );
  const rows = result.rows.slice(0, limit);
  return {
    key: reportKey,
    objectType: definition.objectType,
    columns: OBJECT_COLUMNS[definition.objectType] ?? [],
    limit,
    offset,
    hasMore: result.rows.length > limit,
    results: rows.map((row) => ({
      id: row.record_id,
      properties: row.properties ?? {},
      hubspotCreatedAt: row.hubspot_created_at,
      hubspotUpdatedAt: row.hubspot_updated_at,
      syncedAt: row.synced_at
    }))
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
