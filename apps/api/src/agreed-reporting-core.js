import {
  buildRevenueReportingPack as buildBaseRevenueReportingPack,
  getRevenueDrilldown as getBaseRevenueDrilldown,
  normalizeReportingFilters
} from './revenue-reporting.js';

const OPERATING_REPORT_KEYS = new Set([
  'portfolio-contacts',
  'new-contacts',
  'connected-calls',
  'completed-meetings',
  'no-show-meetings',
  'completed-tasks',
  'open-tasks',
  'tasks-due-today',
  'cold-contacts',
  'deals-at-risk',
  'closing-soon-deals',
  'signed-contract-deals',
  'booked-deals',
  'cashing-deals',
  'priority-needs-contact',
  'retention-upcoming',
  'retention-delayed',
  'retention-renewed-late',
  'retention-lost'
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

function dynamicTimestampSql(alias, parameterIndex) {
  const value = `jsonb_extract_path_text(${alias}.properties, $${parameterIndex}::text)`;
  return `CASE
    WHEN ${value} ~ '^\\d{4}-\\d{2}-\\d{2}' THEN (${value})::timestamptz
    WHEN ${value} ~ '^\\d{10,13}$' THEN to_timestamp(((${value})::numeric) /
      CASE WHEN length(${value}) >= 13 THEN 1000 ELSE 1 END)
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

function dynamicAmountSql(alias, parameterIndex) {
  const value = `jsonb_extract_path_text(${alias}.properties, $${parameterIndex}::text)`;
  return `CASE WHEN COALESCE(${value}, '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
    THEN (${value})::numeric ELSE ${amountSql(alias)} END`;
}

function closedSql(alias = 'r') {
  return `LOWER(COALESCE(${alias}.properties->>'hs_is_closed', 'false')) IN ('true', '1')`;
}

function wonSql(alias = 'r') {
  return `LOWER(COALESCE(${alias}.properties->>'hs_is_closed_won', 'false')) IN ('true', '1')`;
}

function normalizedMappedValueSql(alias, propertyParameter, mappingParameter) {
  const raw = `NULLIF(jsonb_extract_path_text(${alias}.properties, $${propertyParameter}::text), '')`;
  return `COALESCE(($${mappingParameter}::jsonb)->>${raw}, ${raw}, 'Unknown')`;
}

function contactAssociationDimensions(alias, objectType) {
  if (objectType === 'contacts') {
    return `
      AND ($5::text IS NULL OR ${countrySql(alias)} = $5)
      AND ($8::text IS NULL OR ${leadSourceSql(alias)} = $8)`;
  }
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
            (ca.from_object_type = '${objectType}' AND ca.from_record_id = ${alias}.record_id AND ca.to_object_type = 'contacts')
            OR
            (ca.to_object_type = '${objectType}' AND ca.to_record_id = ${alias}.record_id AND ca.from_object_type = 'contacts')
          )
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
            (da.from_object_type = '${objectType}' AND da.from_record_id = ${alias}.record_id AND da.to_object_type = 'deals')
            OR
            (da.to_object_type = '${objectType}' AND da.to_record_id = ${alias}.record_id AND da.from_object_type = 'deals')
          )
          AND ($6::text IS NULL OR NULLIF(deal_record.properties->>'pipeline', '') = $6)
          AND ($7::text IS NULL OR NULLIF(deal_record.properties->>'dealstage', '') = $7)
      )
    )`;
}

function objectPredicate(objectType, alias = 'r', { period = true } = {}) {
  const timestamp = ['calls', 'meetings', 'tasks'].includes(objectType)
    ? activityTimestampSql(alias)
    : `COALESCE(${alias}.hubspot_created_at, ${alias}.synced_at)`;
  return `
    ${alias}.workspace_id = $1
    AND ${alias}.object_type = '${objectType}'
    AND ${alias}.archived = FALSE
    AND $2::date IS NOT NULL
    AND $3::date IS NOT NULL
    ${period ? `AND ${timestamp} >= $2::date AND ${timestamp} < ($3::date + INTERVAL '1 day')` : ''}
    AND ($4::text IS NULL OR ${ownerSql(alias, objectType)} = $4)
    ${contactAssociationDimensions(alias, objectType)}
    ${dealAssociationDimensions(alias, objectType)}`;
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

function mappingKey(semanticKey, objectType) {
  return `${semanticKey}:${objectType}`;
}

async function loadApprovedMappings(postgres, workspaceId) {
  try {
    const result = await postgres.query(
      `SELECT semantic_key, object_type, property_name, value_mapping
       FROM property_mappings
       WHERE workspace_id = $1
       ORDER BY semantic_key, object_type`,
      [workspaceId]
    );
    return new Map(result.rows.map((row) => [mappingKey(row.semantic_key, row.object_type), {
      semanticKey: row.semantic_key,
      objectType: row.object_type,
      propertyName: row.property_name,
      valueMapping: row.value_mapping ?? {}
    }]));
  } catch (error) {
    if (error?.code === '42P01') return new Map();
    throw error;
  }
}

function pickMapping(mappings, semanticKey, objectTypes) {
  for (const objectType of objectTypes) {
    const mapping = mappings.get(mappingKey(semanticKey, objectType));
    if (mapping?.propertyName) return mapping;
  }
  return null;
}

function mappingSummary(mapping) {
  return mapping ? {
    status: 'ready',
    objectType: mapping.objectType,
    propertyName: mapping.propertyName
  } : { status: 'configuration_required', objectType: null, propertyName: null };
}

async function activityExecution(postgres, workspaceId, filters, mappings) {
  const callOutcome = pickMapping(mappings, 'call_outcome', ['calls']) ?? {
    propertyName: 'hs_call_disposition', valueMapping: {}
  };
  const meetingOutcome = pickMapping(mappings, 'meeting_outcome', ['meetings']) ?? {
    propertyName: 'hs_meeting_outcome', valueMapping: {}
  };
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
       AND ${activityTimestampSql('r')} >= $2::date
       AND ${activityTimestampSql('r')} < ($3::date + INTERVAL '1 day')
       AND ($4::text IS NULL OR ${ownerSql('r', 'calls')} = $4)
       ${contactAssociationDimensions('r', 'calls')}
       ${dealAssociationDimensions('r', 'calls')}`,
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

async function currentTaskState(postgres, workspaceId, filters) {
  const values = filterValues(workspaceId, filters);
  const result = await postgres.query(
    `SELECT
       COUNT(*) FILTER (
         WHERE UPPER(COALESCE(r.properties->>'hs_task_status','')) NOT IN ('COMPLETED','DONE','CLOSED')
       )::bigint AS open_tasks,
       COUNT(*) FILTER (
         WHERE UPPER(COALESCE(r.properties->>'hs_task_status','')) NOT IN ('COMPLETED','DONE','CLOSED')
           AND COALESCE(${jsonTimestampSql('hs_timestamp', 'r')}, r.hubspot_created_at)::date = CURRENT_DATE
       )::bigint AS tasks_due_today,
       COUNT(*) FILTER (
         WHERE UPPER(COALESCE(r.properties->>'hs_task_status','')) NOT IN ('COMPLETED','DONE','CLOSED')
           AND COALESCE(${jsonTimestampSql('hs_timestamp', 'r')}, r.hubspot_created_at)::date < CURRENT_DATE
       )::bigint AS overdue_tasks
     FROM crm_records r
     WHERE ${objectPredicate('tasks', 'r', { period: false })}`,
    values
  );
  const row = result.rows[0] ?? {};
  return {
    openTasks: numeric(row.open_tasks),
    tasksDueToday: numeric(row.tasks_due_today),
    overdueTasks: numeric(row.overdue_tasks)
  };
}

async function contactCoverage(postgres, workspaceId, filters) {
  const values = filterValues(workspaceId, filters);
  const contacted = `COALESCE(
    NULLIF(r.properties->>'notes_last_contacted',''),
    NULLIF(r.properties->>'hs_last_sales_activity_timestamp',''),
    NULLIF(r.properties->>'hs_last_sales_activity_date','')
  ) IS NOT NULL`;
  const lastContact = `COALESCE(
    ${jsonTimestampSql('notes_last_contacted', 'r')},
    ${jsonTimestampSql('hs_last_sales_activity_timestamp', 'r')},
    ${jsonTimestampSql('hs_last_sales_activity_date', 'r')}
  )`;
  const result = await postgres.query(
    `SELECT
       COUNT(*)::bigint AS portfolio_contacts,
       COUNT(*) FILTER (
         WHERE COALESCE(r.hubspot_created_at,r.synced_at) >= $2::date
           AND COALESCE(r.hubspot_created_at,r.synced_at) < ($3::date + INTERVAL '1 day')
       )::bigint AS new_contacts,
       COUNT(*) FILTER (WHERE ${contacted})::bigint AS contacted_contacts,
       COUNT(*) FILTER (
         WHERE NOT (${contacted})
           AND COALESCE(r.hubspot_created_at,r.synced_at) < NOW() - INTERVAL '2 days'
       )::bigint AS untouched_contacts,
       COUNT(*) FILTER (
         WHERE ${contacted}
           AND ${lastContact} < NOW() - INTERVAL '21 days'
       )::bigint AS cold_contacts,
       COUNT(*) FILTER (WHERE NULLIF(r.properties->>'hubspot_owner_id','') IS NULL)::bigint AS missing_owner
     FROM crm_records r
     WHERE ${objectPredicate('contacts', 'r', { period: false })}`,
    values
  );
  const row = result.rows[0] ?? {};
  const portfolioContacts = numeric(row.portfolio_contacts);
  const contactedContacts = numeric(row.contacted_contacts);
  return {
    portfolioContacts,
    newContacts: numeric(row.new_contacts),
    contactedContacts,
    leadContactRate: portfolioContacts > 0 ? contactedContacts / portfolioContacts * 100 : 0,
    untouchedContacts: numeric(row.untouched_contacts),
    coldContacts: numeric(row.cold_contacts),
    missingOwnerContacts: numeric(row.missing_owner)
  };
}

function qualityClassificationSql(alias, propertyParameter, mappingParameter) {
  const normalized = `LOWER(${normalizedMappedValueSql(alias, propertyParameter, mappingParameter)})`;
  return `CASE
    WHEN ${normalized} IN ('highest','rank a','a','tier 1','hot','high','priority 1','platinum') THEN 'highest'
    WHEN ${normalized} IN ('medium','rank b','b','tier 2','warm','priority 2','gold') THEN 'medium'
    WHEN ${normalized} IN ('lowest','rank c','c','tier 3','cold','low','priority 3','silver') THEN 'lowest'
    ELSE 'unclassified'
  END`;
}

async function qualityFunnel(postgres, workspaceId, filters, mappings) {
  const qualityMapping = pickMapping(mappings, 'lead_quality', ['contacts']);
  const meetingOutcome = pickMapping(mappings, 'meeting_outcome', ['meetings']) ?? {
    propertyName: 'hs_meeting_outcome', valueMapping: {}
  };
  if (!qualityMapping) {
    return {
      status: 'configuration_required',
      mapping: mappingSummary(null),
      rows: [],
      countryCoverage: [],
      priorityNeedsContact: 0,
      message: 'Approve the Lead Quality mapping to activate Rank/Tier reporting.'
    };
  }
  const values = [
    ...filterValues(workspaceId, filters),
    qualityMapping.propertyName,
    JSON.stringify(qualityMapping.valueMapping ?? {}),
    meetingOutcome.propertyName,
    JSON.stringify(meetingOutcome.valueMapping ?? {})
  ];
  const quality = qualityClassificationSql('r', 9, 10);
  const completedMeeting = `LOWER(${normalizedMappedValueSql('meeting_record', 11, 12)}) ~ '(completed|held|attended|finished)'`;
  const contacted = `COALESCE(
    NULLIF(r.properties->>'notes_last_contacted',''),
    NULLIF(r.properties->>'hs_last_sales_activity_timestamp',''),
    NULLIF(r.properties->>'hs_last_sales_activity_date','')
  ) IS NOT NULL`;
  const result = await postgres.query(
    `WITH contacts AS (
       SELECT
         r.record_id,
         ${quality} AS quality,
         ${countrySql('r')} AS country,
         (${contacted}) AS contacted,
         COALESCE(r.hubspot_created_at,r.synced_at) AS created_at,
         EXISTS (
           SELECT 1 FROM crm_record_associations ma
           JOIN crm_records meeting_record
             ON meeting_record.workspace_id = ma.workspace_id
            AND meeting_record.object_type = 'meetings'
            AND meeting_record.record_id = CASE WHEN ma.from_object_type = 'meetings' THEN ma.from_record_id ELSE ma.to_record_id END
            AND meeting_record.archived = FALSE
           WHERE ma.workspace_id = $1
             AND ((ma.from_object_type = 'contacts' AND ma.from_record_id = r.record_id AND ma.to_object_type = 'meetings')
               OR (ma.to_object_type = 'contacts' AND ma.to_record_id = r.record_id AND ma.from_object_type = 'meetings'))
             AND ${activityTimestampSql('meeting_record')} >= $2::date
             AND ${activityTimestampSql('meeting_record')} < ($3::date + INTERVAL '1 day')
             AND ${completedMeeting}
         ) AS completed_meeting,
         EXISTS (
           SELECT 1 FROM crm_record_associations da
           JOIN crm_records deal_record
             ON deal_record.workspace_id = da.workspace_id
            AND deal_record.object_type = 'deals'
            AND deal_record.record_id = CASE WHEN da.from_object_type = 'deals' THEN da.from_record_id ELSE da.to_record_id END
            AND deal_record.archived = FALSE
           WHERE da.workspace_id = $1
             AND ((da.from_object_type = 'contacts' AND da.from_record_id = r.record_id AND da.to_object_type = 'deals')
               OR (da.to_object_type = 'contacts' AND da.to_record_id = r.record_id AND da.from_object_type = 'deals'))
             AND NOT (${closedSql('deal_record')})
         ) AS open_opportunity,
         EXISTS (
           SELECT 1 FROM crm_record_associations da
           JOIN crm_records deal_record
             ON deal_record.workspace_id = da.workspace_id
            AND deal_record.object_type = 'deals'
            AND deal_record.record_id = CASE WHEN da.from_object_type = 'deals' THEN da.from_record_id ELSE da.to_record_id END
            AND deal_record.archived = FALSE
           WHERE da.workspace_id = $1
             AND ((da.from_object_type = 'contacts' AND da.from_record_id = r.record_id AND da.to_object_type = 'deals')
               OR (da.to_object_type = 'contacts' AND da.to_record_id = r.record_id AND da.from_object_type = 'deals'))
             AND ${wonSql('deal_record')}
             AND COALESCE(${jsonTimestampSql('closedate', 'deal_record')}, deal_record.hubspot_updated_at, deal_record.synced_at) >= $2::date
             AND COALESCE(${jsonTimestampSql('closedate', 'deal_record')}, deal_record.hubspot_updated_at, deal_record.synced_at) < ($3::date + INTERVAL '1 day')
         ) AS won
       FROM crm_records r
       WHERE ${objectPredicate('contacts', 'r', { period: false })}
     )
     SELECT
       quality,
       COUNT(*)::bigint AS contacts,
       COUNT(*) FILTER (WHERE contacted)::bigint AS contacted,
       COUNT(*) FILTER (WHERE completed_meeting)::bigint AS meetings_completed,
       COUNT(*) FILTER (WHERE open_opportunity)::bigint AS opportunities,
       COUNT(*) FILTER (WHERE won)::bigint AS won,
       COUNT(*) FILTER (
         WHERE quality IN ('highest','medium')
           AND NOT contacted
           AND created_at < NOW() - INTERVAL '2 days'
       )::bigint AS needs_contact
     FROM contacts
     GROUP BY quality
     ORDER BY CASE quality WHEN 'highest' THEN 1 WHEN 'medium' THEN 2 WHEN 'lowest' THEN 3 ELSE 4 END`,
    values
  );
  const countryResult = await postgres.query(
    `SELECT ${countrySql('r')} AS country, ${quality} AS quality, COUNT(*)::bigint AS contacts
     FROM crm_records r
     WHERE ${objectPredicate('contacts', 'r', { period: false })}
     GROUP BY 1,2
     ORDER BY contacts DESC, country
     LIMIT 40`,
    values
  );
  const rows = result.rows.map((row) => {
    const contacts = numeric(row.contacts);
    const contactedCount = numeric(row.contacted);
    return {
      quality: row.quality,
      contacts,
      contacted: contactedCount,
      contactRate: contacts > 0 ? contactedCount / contacts * 100 : 0,
      meetingsCompleted: numeric(row.meetings_completed),
      opportunities: numeric(row.opportunities),
      won: numeric(row.won),
      needsContact: numeric(row.needs_contact)
    };
  });
  return {
    status: 'ready',
    mapping: mappingSummary(qualityMapping),
    rows,
    countryCoverage: countryResult.rows.map((row) => ({
      country: row.country || 'Unknown', quality: row.quality, contacts: numeric(row.contacts)
    })),
    priorityNeedsContact: rows.reduce((total, row) => total + row.needsContact, 0),
    message: null
  };
}

async function revenueHealth(postgres, workspaceId, filters) {
  const values = filterValues(workspaceId, filters);
  const result = await postgres.query(
    `SELECT
       COUNT(*) FILTER (WHERE NOT (${closedSql('r')}))::bigint AS open_deals,
       COALESCE(SUM(${amountSql('r')}) FILTER (WHERE NOT (${closedSql('r')})),0)::numeric AS open_pipeline,
       COUNT(*) FILTER (
         WHERE NOT (${closedSql('r')})
           AND (NULLIF(r.properties->>'hs_next_activity_date','') IS NULL OR ${jsonTimestampSql('closedate','r')} < CURRENT_DATE)
       )::bigint AS deals_at_risk,
       COALESCE(SUM(${amountSql('r')}) FILTER (
         WHERE NOT (${closedSql('r')})
           AND (NULLIF(r.properties->>'hs_next_activity_date','') IS NULL OR ${jsonTimestampSql('closedate','r')} < CURRENT_DATE)
       ),0)::numeric AS at_risk_pipeline,
       COUNT(*) FILTER (
         WHERE NOT (${closedSql('r')}) AND ${jsonTimestampSql('closedate','r')} < CURRENT_DATE
       )::bigint AS overdue_close_deals,
       COALESCE(SUM(${amountSql('r')}) FILTER (
         WHERE NOT (${closedSql('r')}) AND ${jsonTimestampSql('closedate','r')} < CURRENT_DATE
       ),0)::numeric AS overdue_close_pipeline,
       COUNT(*) FILTER (
         WHERE NOT (${closedSql('r')})
           AND ${jsonTimestampSql('closedate','r')} >= CURRENT_DATE
           AND ${jsonTimestampSql('closedate','r')} < CURRENT_DATE + INTERVAL '14 days'
       )::bigint AS closing_soon_deals,
       COALESCE(SUM(${amountSql('r')}) FILTER (
         WHERE NOT (${closedSql('r')})
           AND ${jsonTimestampSql('closedate','r')} >= CURRENT_DATE
           AND ${jsonTimestampSql('closedate','r')} < CURRENT_DATE + INTERVAL '14 days'
       ),0)::numeric AS closing_soon_pipeline,
       COUNT(*) FILTER (
         WHERE ${wonSql('r')}
           AND COALESCE(${jsonTimestampSql('closedate','r')},r.hubspot_updated_at,r.synced_at) >= $2::date
           AND COALESCE(${jsonTimestampSql('closedate','r')},r.hubspot_updated_at,r.synced_at) < ($3::date + INTERVAL '1 day')
       )::bigint AS won_deals,
       COALESCE(SUM(${amountSql('r')}) FILTER (
         WHERE ${wonSql('r')}
           AND COALESCE(${jsonTimestampSql('closedate','r')},r.hubspot_updated_at,r.synced_at) >= $2::date
           AND COALESCE(${jsonTimestampSql('closedate','r')},r.hubspot_updated_at,r.synced_at) < ($3::date + INTERVAL '1 day')
       ),0)::numeric AS won_revenue,
       COUNT(*) FILTER (WHERE LOWER(COALESCE(s.label,r.properties->>'dealstage','')) ~ '(signed|contract)')::bigint AS signed_contract_deals,
       COALESCE(SUM(${amountSql('r')}) FILTER (WHERE LOWER(COALESCE(s.label,r.properties->>'dealstage','')) ~ '(signed|contract)'),0)::numeric AS signed_contract_value,
       COUNT(*) FILTER (WHERE LOWER(COALESCE(s.label,r.properties->>'dealstage','')) ~ 'booked')::bigint AS booked_deals,
       COALESCE(SUM(${amountSql('r')}) FILTER (WHERE LOWER(COALESCE(s.label,r.properties->>'dealstage','')) ~ 'booked'),0)::numeric AS booked_value,
       COUNT(*) FILTER (WHERE LOWER(COALESCE(s.label,r.properties->>'dealstage','')) ~ '(cash|paid|collect)')::bigint AS cashing_deals,
       COALESCE(SUM(${amountSql('r')}) FILTER (WHERE LOWER(COALESCE(s.label,r.properties->>'dealstage','')) ~ '(cash|paid|collect)'),0)::numeric AS cashing_value
     FROM crm_records r
     LEFT JOIN crm_pipeline_stages s
       ON s.workspace_id = r.workspace_id
      AND s.object_type = 'deals'
      AND s.pipeline_id = r.properties->>'pipeline'
      AND s.stage_id = r.properties->>'dealstage'
     WHERE ${objectPredicate('deals', 'r', { period: false })}`,
    values
  );
  const row = result.rows[0] ?? {};
  return {
    openDeals: numeric(row.open_deals),
    openPipeline: numeric(row.open_pipeline),
    dealsAtRisk: numeric(row.deals_at_risk),
    atRiskPipeline: numeric(row.at_risk_pipeline),
    overdueCloseDeals: numeric(row.overdue_close_deals),
    overdueClosePipeline: numeric(row.overdue_close_pipeline),
    closingSoonDeals: numeric(row.closing_soon_deals),
    closingSoonPipeline: numeric(row.closing_soon_pipeline),
    wonDeals: numeric(row.won_deals),
    wonRevenue: numeric(row.won_revenue),
    commercialMilestones: {
      signedContract: { deals: numeric(row.signed_contract_deals), value: numeric(row.signed_contract_value), confidence: 'stage_label_inferred' },
      booked: { deals: numeric(row.booked_deals), value: numeric(row.booked_value), confidence: 'stage_label_inferred' },
      cashing: { deals: numeric(row.cashing_deals), value: numeric(row.cashing_value), confidence: 'stage_label_inferred' }
    }
  };
}

async function retentionReporting(postgres, workspaceId, filters, mappings) {
  const renewal = pickMapping(mappings, 'renewal_date', ['deals']);
  const revenue = pickMapping(mappings, 'revenue', ['deals']);
  const accountStatus = pickMapping(mappings, 'account_status', ['deals']);
  const product = pickMapping(mappings, 'product', ['deals']);
  const missingMappings = [];
  if (!renewal) missingMappings.push('renewal_date:deals');
  if (!product) missingMappings.push('product:deals');
  if (!accountStatus) missingMappings.push('account_status:deals');
  if (!revenue) missingMappings.push('revenue:deals');
  if (!renewal) {
    return {
      status: 'configuration_required',
      sourceMode: 'hubspot_fallback',
      missingMappings,
      mappings: {
        renewalDate: mappingSummary(renewal),
        product: mappingSummary(product),
        accountStatus: mappingSummary(accountStatus),
        revenue: mappingSummary(revenue)
      },
      metrics: null,
      productBreakdown: [],
      message: 'Map Renewal Date on deals to activate Upcoming, Delayed, Renewed Late and Lost retention reports.'
    };
  }
  const values = [
    ...filterValues(workspaceId, filters),
    renewal.propertyName,
    revenue?.propertyName ?? 'amount',
    accountStatus?.propertyName ?? 'hs_is_closed_won',
    JSON.stringify(accountStatus?.valueMapping ?? {}),
    product?.propertyName ?? 'product'
  ];
  const renewalDate = dynamicTimestampSql('r', 9);
  const revenueValue = dynamicAmountSql('r', 10);
  const statusValue = `LOWER(${normalizedMappedValueSql('r', 11, 12)})`;
  const productValue = `COALESCE(NULLIF(jsonb_extract_path_text(r.properties, $13::text),''),'Unspecified')`;
  const inactive = `${statusValue} ~ '(inactive|churn|lost|cancel)'`;
  const result = await postgres.query(
    `SELECT
       COUNT(*) FILTER (
         WHERE ${renewalDate} >= date_trunc('month', CURRENT_DATE)
           AND NOT (${wonSql('r')}) AND NOT (${inactive})
       )::bigint AS upcoming,
       COUNT(*) FILTER (
         WHERE ${renewalDate} < date_trunc('month', CURRENT_DATE)
           AND NOT (${wonSql('r')}) AND NOT (${inactive})
       )::bigint AS delayed,
       COUNT(*) FILTER (
         WHERE ${wonSql('r')}
           AND COALESCE(${jsonTimestampSql('closedate','r')},r.hubspot_updated_at,r.synced_at) > ${renewalDate}
       )::bigint AS renewed_late,
       COUNT(*) FILTER (WHERE (${inactive}) OR (${closedSql('r')} AND NOT (${wonSql('r')})))::bigint AS lost,
       COUNT(*) FILTER (WHERE ${wonSql('r')})::bigint AS booked,
       COALESCE(SUM(${revenueValue}) FILTER (WHERE ${wonSql('r')}),0)::numeric AS cash_collected,
       COALESCE(SUM(${revenueValue}) FILTER (WHERE ${renewalDate} IS NOT NULL),0)::numeric AS renewal_value,
       COALESCE(SUM(${revenueValue}) FILTER (WHERE NOT (${wonSql('r')}) AND NOT (${inactive})),0)::numeric AS remaining_collection,
       COUNT(*) FILTER (WHERE ${renewalDate} IS NULL)::bigint AS not_in_budget
     FROM crm_records r
     WHERE ${objectPredicate('deals', 'r', { period: false })}`,
    values
  );
  const breakdown = await postgres.query(
    `SELECT ${productValue} AS product,
       COUNT(*)::bigint AS accounts,
       COALESCE(SUM(${revenueValue}),0)::numeric AS renewal_value
     FROM crm_records r
     WHERE ${objectPredicate('deals', 'r', { period: false })}
       AND ${renewalDate} IS NOT NULL
     GROUP BY 1
     ORDER BY renewal_value DESC, product
     LIMIT 20`,
    values
  );
  const row = result.rows[0] ?? {};
  return {
    status: 'ready',
    sourceMode: 'hubspot_fallback',
    missingMappings,
    mappings: {
      renewalDate: mappingSummary(renewal),
      product: mappingSummary(product),
      accountStatus: mappingSummary(accountStatus),
      revenue: mappingSummary(revenue)
    },
    metrics: {
      upcoming: numeric(row.upcoming),
      delayed: numeric(row.delayed),
      renewedLate: numeric(row.renewed_late),
      lost: numeric(row.lost),
      booked: numeric(row.booked),
      cashCollected: numeric(row.cash_collected),
      renewalValue: numeric(row.renewal_value),
      remainingCollection: numeric(row.remaining_collection),
      notInBudget: numeric(row.not_in_budget)
    },
    productBreakdown: breakdown.rows.map((item) => ({
      product: item.product || 'Unspecified',
      accounts: numeric(item.accounts),
      renewalValue: numeric(item.renewal_value)
    })),
    message: missingMappings.length
      ? 'Retention is active with HubSpot fallback logic; complete the optional mappings for exact product, status and revenue definitions.'
      : 'Retention is active from approved HubSpot semantic mappings. Connect the Budget source to make it the commercial source of truth.'
  };
}

async function buildOperatingReports(postgres, workspaceId, filters) {
  const mappings = await loadApprovedMappings(postgres, workspaceId);
  const [execution, yesterday, tasks, contacts, quality, revenue, retention] = await Promise.all([
    activityExecution(postgres, workspaceId, filters, mappings),
    activityExecution(postgres, workspaceId, previousDayFilters(filters), mappings),
    currentTaskState(postgres, workspaceId, filters),
    contactCoverage(postgres, workspaceId, filters),
    qualityFunnel(postgres, workspaceId, filters, mappings),
    revenueHealth(postgres, workspaceId, filters),
    retentionReporting(postgres, workspaceId, filters, mappings)
  ]);
  return {
    definitionsVersion: '2026-07-24',
    mappings: {
      leadQuality: mappingSummary(pickMapping(mappings, 'lead_quality', ['contacts'])),
      callOutcome: mappingSummary(pickMapping(mappings, 'call_outcome', ['calls'])),
      meetingOutcome: mappingSummary(pickMapping(mappings, 'meeting_outcome', ['meetings'])),
      renewalDate: mappingSummary(pickMapping(mappings, 'renewal_date', ['deals']))
    },
    todayFocus: {
      priorityNeedsContact: quality.priorityNeedsContact,
      untouchedContacts: contacts.untouchedContacts,
      coldContacts: contacts.coldContacts,
      overdueTasks: tasks.overdueTasks,
      tasksDueToday: tasks.tasksDueToday,
      dealsAtRisk: revenue.dealsAtRisk,
      overdueCloseDeals: revenue.overdueCloseDeals
    },
    execution: { ...execution, ...tasks, ...contacts },
    yesterday,
    qualityFunnel: quality,
    revenueHealth: revenue,
    retention
  };
}

export async function buildRevenueReportingPack(postgres, workspaceId, rawFilters = {}) {
  const base = await buildBaseRevenueReportingPack(postgres, workspaceId, rawFilters);
  const operatingReports = await buildOperatingReports(postgres, workspaceId, base.filters);
  return {
    ...base,
    operatingReports,
    drilldowns: [...new Set([...(base.drilldowns ?? []), ...OPERATING_REPORT_KEYS])]
  };
}

function staticDrilldownDefinition(reportKey) {
  const definitions = {
    'portfolio-contacts': { objectType: 'contacts', period: false, condition: 'TRUE', orderBy: 'COALESCE(r.hubspot_created_at,r.synced_at) DESC' },
    'new-contacts': { objectType: 'contacts', period: false, condition: `COALESCE(r.hubspot_created_at,r.synced_at) >= $2::date AND COALESCE(r.hubspot_created_at,r.synced_at) < ($3::date + INTERVAL '1 day')`, orderBy: 'COALESCE(r.hubspot_created_at,r.synced_at) DESC' },
    'connected-calls': { objectType: 'calls', period: true, condition: `(r.properties->>'hs_call_disposition' = 'f240bbac-87c9-4f6e-bf70-924b57d47db7' OR LOWER(COALESCE(r.properties->>'hs_call_disposition',r.properties->>'hs_call_status','')) ~ '(connected|answered|spoke|reached|successful)')`, orderBy: `${activityTimestampSql('r')} DESC` },
    'completed-meetings': { objectType: 'meetings', period: true, condition: `LOWER(COALESCE(r.properties->>'hs_meeting_outcome','')) ~ '(completed|held|attended|finished)'`, orderBy: `${activityTimestampSql('r')} DESC` },
    'no-show-meetings': { objectType: 'meetings', period: true, condition: `LOWER(COALESCE(r.properties->>'hs_meeting_outcome','')) ~ '(no[ _-]?show|did not attend|missed)'`, orderBy: `${activityTimestampSql('r')} DESC` },
    'completed-tasks': { objectType: 'tasks', period: true, condition: `UPPER(COALESCE(r.properties->>'hs_task_status','')) IN ('COMPLETED','DONE','CLOSED')`, orderBy: `${activityTimestampSql('r')} DESC` },
    'open-tasks': { objectType: 'tasks', period: false, condition: `UPPER(COALESCE(r.properties->>'hs_task_status','')) NOT IN ('COMPLETED','DONE','CLOSED')`, orderBy: `COALESCE(${jsonTimestampSql('hs_timestamp','r')},r.hubspot_created_at) ASC` },
    'tasks-due-today': { objectType: 'tasks', period: false, condition: `UPPER(COALESCE(r.properties->>'hs_task_status','')) NOT IN ('COMPLETED','DONE','CLOSED') AND COALESCE(${jsonTimestampSql('hs_timestamp','r')},r.hubspot_created_at)::date = CURRENT_DATE`, orderBy: `COALESCE(${jsonTimestampSql('hs_timestamp','r')},r.hubspot_created_at) ASC` },
    'cold-contacts': { objectType: 'contacts', period: false, condition: `COALESCE(${jsonTimestampSql('notes_last_contacted','r')},${jsonTimestampSql('hs_last_sales_activity_timestamp','r')},${jsonTimestampSql('hs_last_sales_activity_date','r')}) < NOW() - INTERVAL '21 days'`, orderBy: `COALESCE(${jsonTimestampSql('notes_last_contacted','r')},${jsonTimestampSql('hs_last_sales_activity_timestamp','r')},${jsonTimestampSql('hs_last_sales_activity_date','r')}) ASC` },
    'deals-at-risk': { objectType: 'deals', period: false, condition: `NOT (${closedSql('r')}) AND (NULLIF(r.properties->>'hs_next_activity_date','') IS NULL OR ${jsonTimestampSql('closedate','r')} < CURRENT_DATE)`, orderBy: `${amountSql('r')} DESC` },
    'closing-soon-deals': { objectType: 'deals', period: false, condition: `NOT (${closedSql('r')}) AND ${jsonTimestampSql('closedate','r')} >= CURRENT_DATE AND ${jsonTimestampSql('closedate','r')} < CURRENT_DATE + INTERVAL '14 days'`, orderBy: `${jsonTimestampSql('closedate','r')} ASC` },
    'signed-contract-deals': { objectType: 'deals', period: false, joinStages: true, condition: `LOWER(COALESCE(s.label,r.properties->>'dealstage','')) ~ '(signed|contract)'`, orderBy: `${amountSql('r')} DESC` },
    'booked-deals': { objectType: 'deals', period: false, joinStages: true, condition: `LOWER(COALESCE(s.label,r.properties->>'dealstage','')) ~ 'booked'`, orderBy: `${amountSql('r')} DESC` },
    'cashing-deals': { objectType: 'deals', period: false, joinStages: true, condition: `LOWER(COALESCE(s.label,r.properties->>'dealstage','')) ~ '(cash|paid|collect)'`, orderBy: `${amountSql('r')} DESC` }
  };
  return definitions[reportKey] ?? null;
}

async function staticOperatingDrilldown(postgres, workspaceId, reportKey, rawFilters) {
  const filters = normalizeReportingFilters(rawFilters);
  const definition = staticDrilldownDefinition(reportKey);
  const limit = Math.max(1, Math.min(200, Number(rawFilters.limit) || 50));
  const offset = Math.max(0, Number(rawFilters.offset) || 0);
  const values = [...filterValues(workspaceId, filters), limit + 1, offset];
  const join = definition.joinStages ? `LEFT JOIN crm_pipeline_stages s
    ON s.workspace_id = r.workspace_id AND s.object_type = 'deals'
   AND s.pipeline_id = r.properties->>'pipeline' AND s.stage_id = r.properties->>'dealstage'` : '';
  const result = await postgres.query(
    `SELECT r.record_id, r.properties, r.hubspot_created_at, r.hubspot_updated_at, r.synced_at
     FROM crm_records r
     ${join}
     WHERE ${objectPredicate(definition.objectType, 'r', { period: definition.period })}
       AND (${definition.condition})
     ORDER BY ${definition.orderBy}, r.record_id
     LIMIT $9 OFFSET $10`,
    values
  );
  return formatDrilldown(reportKey, definition.objectType, result.rows, limit, offset);
}

function formatDrilldown(key, objectType, resultRows, limit, offset) {
  const rows = resultRows.slice(0, limit);
  return {
    key,
    objectType,
    columns: OBJECT_COLUMNS[objectType] ?? [],
    limit,
    offset,
    hasMore: resultRows.length > limit,
    results: rows.map((row) => ({
      id: row.record_id,
      properties: row.properties ?? {},
      hubspotCreatedAt: row.hubspot_created_at,
      hubspotUpdatedAt: row.hubspot_updated_at,
      syncedAt: row.synced_at
    }))
  };
}

async function priorityDrilldown(postgres, workspaceId, rawFilters) {
  const filters = normalizeReportingFilters(rawFilters);
  const mappings = await loadApprovedMappings(postgres, workspaceId);
  const qualityMapping = pickMapping(mappings, 'lead_quality', ['contacts']);
  if (!qualityMapping) {
    const error = new Error('Lead Quality mapping is required for the priority contact report.');
    error.statusCode = 409;
    error.category = 'REPORT_CONFIGURATION_REQUIRED';
    throw error;
  }
  const limit = Math.max(1, Math.min(200, Number(rawFilters.limit) || 50));
  const offset = Math.max(0, Number(rawFilters.offset) || 0);
  const values = [
    ...filterValues(workspaceId, filters),
    qualityMapping.propertyName,
    JSON.stringify(qualityMapping.valueMapping ?? {}),
    limit + 1,
    offset
  ];
  const quality = qualityClassificationSql('r', 9, 10);
  const result = await postgres.query(
    `SELECT r.record_id, r.properties, r.hubspot_created_at, r.hubspot_updated_at, r.synced_at
     FROM crm_records r
     WHERE ${objectPredicate('contacts', 'r', { period: false })}
       AND ${quality} IN ('highest','medium')
       AND COALESCE(NULLIF(r.properties->>'notes_last_contacted',''),NULLIF(r.properties->>'hs_last_sales_activity_timestamp',''),NULLIF(r.properties->>'hs_last_sales_activity_date','')) IS NULL
       AND COALESCE(r.hubspot_created_at,r.synced_at) < NOW() - INTERVAL '2 days'
     ORDER BY CASE ${quality} WHEN 'highest' THEN 1 ELSE 2 END, COALESCE(r.hubspot_created_at,r.synced_at) ASC
     LIMIT $11 OFFSET $12`,
    values
  );
  return formatDrilldown('priority-needs-contact', 'contacts', result.rows, limit, offset);
}

async function retentionDrilldown(postgres, workspaceId, reportKey, rawFilters) {
  const filters = normalizeReportingFilters(rawFilters);
  const mappings = await loadApprovedMappings(postgres, workspaceId);
  const renewal = pickMapping(mappings, 'renewal_date', ['deals']);
  const accountStatus = pickMapping(mappings, 'account_status', ['deals']);
  if (!renewal) {
    const error = new Error('Renewal Date mapping on deals is required for this retention report.');
    error.statusCode = 409;
    error.category = 'REPORT_CONFIGURATION_REQUIRED';
    throw error;
  }
  const limit = Math.max(1, Math.min(200, Number(rawFilters.limit) || 50));
  const offset = Math.max(0, Number(rawFilters.offset) || 0);
  const values = [
    ...filterValues(workspaceId, filters),
    renewal.propertyName,
    accountStatus?.propertyName ?? 'hs_is_closed_won',
    JSON.stringify(accountStatus?.valueMapping ?? {}),
    limit + 1,
    offset
  ];
  const renewalDate = dynamicTimestampSql('r', 9);
  const statusValue = `LOWER(${normalizedMappedValueSql('r', 10, 11)})`;
  const inactive = `${statusValue} ~ '(inactive|churn|lost|cancel)'`;
  const conditions = {
    'retention-upcoming': `${renewalDate} >= date_trunc('month', CURRENT_DATE) AND NOT (${wonSql('r')}) AND NOT (${inactive})`,
    'retention-delayed': `${renewalDate} < date_trunc('month', CURRENT_DATE) AND NOT (${wonSql('r')}) AND NOT (${inactive})`,
    'retention-renewed-late': `${wonSql('r')} AND COALESCE(${jsonTimestampSql('closedate','r')},r.hubspot_updated_at,r.synced_at) > ${renewalDate}`,
    'retention-lost': `(${inactive}) OR (${closedSql('r')} AND NOT (${wonSql('r')}))`
  };
  const result = await postgres.query(
    `SELECT r.record_id, r.properties, r.hubspot_created_at, r.hubspot_updated_at, r.synced_at
     FROM crm_records r
     WHERE ${objectPredicate('deals', 'r', { period: false })}
       AND (${conditions[reportKey]})
     ORDER BY ${renewalDate} ASC NULLS LAST, r.record_id
     LIMIT $12 OFFSET $13`,
    values
  );
  return formatDrilldown(reportKey, 'deals', result.rows, limit, offset);
}

export async function getRevenueDrilldown(postgres, workspaceId, reportKey, rawFilters = {}) {
  if (!OPERATING_REPORT_KEYS.has(reportKey)) {
    return getBaseRevenueDrilldown(postgres, workspaceId, reportKey, rawFilters);
  }
  if (reportKey === 'priority-needs-contact') {
    return priorityDrilldown(postgres, workspaceId, rawFilters);
  }
  if (reportKey.startsWith('retention-')) {
    return retentionDrilldown(postgres, workspaceId, reportKey, rawFilters);
  }
  return staticOperatingDrilldown(postgres, workspaceId, reportKey, rawFilters);
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

export { normalizeReportingFilters };
