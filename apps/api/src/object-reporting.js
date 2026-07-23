import { normalizeReportingFilters } from './revenue-reporting.js';

const SUPPORTED_OBJECT_TYPES = Object.freeze([
  'contacts',
  'companies',
  'deals',
  'calls',
  'meetings',
  'tasks',
  'tickets'
]);

const OBJECT_TYPE_SET = new Set(SUPPORTED_OBJECT_TYPES);

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

function createdTimestampSql(alias = 'r') {
  return `COALESCE(${alias}.hubspot_created_at, ${alias}.synced_at)`;
}

function updatedTimestampSql(alias = 'r') {
  return `COALESCE(${alias}.hubspot_updated_at, ${alias}.hubspot_created_at, ${alias}.synced_at)`;
}

function activityTimestampSql(alias = 'r') {
  return `COALESCE(
    ${jsonTimestampSql('hs_timestamp', alias)},
    ${jsonTimestampSql('hs_meeting_start_time', alias)},
    ${jsonTimestampSql('hs_task_completion_date', alias)},
    ${alias}.hubspot_created_at,
    ${alias}.hubspot_updated_at,
    ${alias}.synced_at
  )`;
}

function objectTimestampSql(objectType, alias = 'r') {
  return ['calls', 'meetings', 'tasks'].includes(objectType)
    ? activityTimestampSql(alias)
    : createdTimestampSql(alias);
}

function universalTimestampSql(alias = 'r') {
  return `CASE
    WHEN ${alias}.object_type IN ('calls', 'meetings', 'tasks') THEN ${activityTimestampSql(alias)}
    ELSE ${createdTimestampSql(alias)}
  END`;
}

function ownerSql(alias = 'r') {
  return `COALESCE(
    NULLIF(${alias}.properties->>'hubspot_owner_id', ''),
    NULLIF(${alias}.properties->>'hs_activity_assigned_to_user_id', ''),
    NULLIF(${alias}.properties->>'hs_created_by_user_id', '')
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

function periodCondition(timestampSql, fromParam = '$2', toParam = '$3') {
  return `${timestampSql} >= ${fromParam}::date AND ${timestampSql} < (${toParam}::date + INTERVAL '1 day')`;
}

function associationExists(alias, associatedObjectType) {
  return `EXISTS (
    SELECT 1
    FROM crm_record_associations a
    WHERE a.workspace_id = ${alias}.workspace_id
      AND (
        (
          a.from_object_type = ${alias}.object_type
          AND a.from_record_id = ${alias}.record_id
          AND a.to_object_type = '${associatedObjectType}'
        )
        OR (
          a.to_object_type = ${alias}.object_type
          AND a.to_record_id = ${alias}.record_id
          AND a.from_object_type = '${associatedObjectType}'
        )
      )
  )`;
}

function metric(key, sqlAlias, label, description, condition, options = {}) {
  return Object.freeze({
    key,
    sqlAlias,
    label,
    description,
    condition,
    aggregate: options.aggregate ?? 'count',
    format: options.format ?? 'number',
    tone: options.tone ?? 'neutral'
  });
}

const OBJECT_CONFIG = Object.freeze({
  contacts: {
    label: 'Contacts',
    description: 'Lead coverage, completeness, engagement and CRM conversion readiness.',
    columns: ['firstname', 'lastname', 'email', 'phone', 'mobilephone', 'company', 'country', 'hubspot_owner_id', 'hs_lead_status', 'lifecyclestage', 'notes_last_contacted'],
    breakdowns: [
      {
        key: 'lifecycle-stage',
        label: 'Lifecycle stage',
        expression: (alias) => `COALESCE(NULLIF(${alias}.properties->>'lifecyclestage', ''), 'Unknown')`
      },
      {
        key: 'lead-source',
        label: 'Lead source',
        expression: (alias) => `COALESCE(
          NULLIF(${alias}.properties->>'hs_analytics_source', ''),
          NULLIF(${alias}.properties->>'lead_source', ''),
          NULLIF(${alias}.properties->>'original_source', ''),
          'Unknown'
        )`
      }
    ],
    metrics: [
      metric('missing-email', 'missing_email', 'Missing email', 'Contacts that cannot be reached by email.', (a) => `NULLIF(${a}.properties->>'email', '') IS NULL`, { tone: 'warning' }),
      metric('missing-phone', 'missing_phone', 'Missing phone', 'Contacts without phone or mobile phone.', (a) => `NULLIF(${a}.properties->>'phone', '') IS NULL AND NULLIF(${a}.properties->>'mobilephone', '') IS NULL`, { tone: 'warning' }),
      metric('untouched', 'untouched', 'Untouched contacts', 'Contacts with no recorded last-contact date.', (a) => `NULLIF(${a}.properties->>'notes_last_contacted', '') IS NULL`, { tone: 'critical' }),
      metric('stale', 'stale', 'Stale contacts', 'Last contacted more than 21 days ago.', (a) => `${jsonTimestampSql('notes_last_contacted', a)} < NOW() - INTERVAL '21 days'`, { tone: 'warning' }),
      metric('customers', 'customers', 'Customer lifecycle', 'Contacts currently marked as customers.', (a) => `LOWER(COALESCE(${a}.properties->>'lifecyclestage', '')) = 'customer'`, { tone: 'good' }),
      metric('with-deal', 'with_deal', 'Associated to deals', 'Contacts linked to at least one deal.', (a) => associationExists(a, 'deals'), { tone: 'accent' }),
      metric('without-company', 'without_company', 'Missing company link', 'Contacts not associated to a company record.', (a) => `NOT (${associationExists(a, 'companies')})`, { tone: 'warning' })
    ]
  },
  companies: {
    label: 'Companies',
    description: 'Account coverage, ownership, segmentation and commercial activity.',
    columns: ['name', 'domain', 'industry', 'country', 'city', 'phone', 'numberofemployees', 'hubspot_owner_id', 'account_status', 'account_type'],
    breakdowns: [
      {
        key: 'industry',
        label: 'Industry',
        expression: (alias) => `COALESCE(NULLIF(${alias}.properties->>'industry', ''), 'Unknown')`
      },
      {
        key: 'account-status',
        label: 'Account status',
        expression: (alias) => `COALESCE(NULLIF(${alias}.properties->>'account_status', ''), 'Unknown')`
      }
    ],
    metrics: [
      metric('missing-domain', 'missing_domain', 'Missing domain', 'Company records without a website domain.', (a) => `NULLIF(${a}.properties->>'domain', '') IS NULL`, { tone: 'warning' }),
      metric('missing-industry', 'missing_industry', 'Missing industry', 'Company records without industry segmentation.', (a) => `NULLIF(${a}.properties->>'industry', '') IS NULL`, { tone: 'warning' }),
      metric('active-accounts', 'active_accounts', 'Active accounts', 'Companies currently marked active.', (a) => `LOWER(COALESCE(${a}.properties->>'account_status', '')) = 'active'`, { tone: 'good' }),
      metric('churned-accounts', 'churned_accounts', 'Churned accounts', 'Companies currently marked churned.', (a) => `LOWER(COALESCE(${a}.properties->>'account_status', '')) = 'churned'`, { tone: 'critical' }),
      metric('with-deal', 'with_deal', 'Companies with deals', 'Company records associated with at least one deal.', (a) => associationExists(a, 'deals'), { tone: 'accent' }),
      metric('without-deal', 'without_deal', 'Companies without deals', 'Company records with no associated deal.', (a) => `NOT (${associationExists(a, 'deals')})`, { tone: 'warning' })
    ]
  },
  deals: {
    label: 'Deals',
    description: 'Pipeline, revenue, risk, conversion and association coverage.',
    columns: ['dealname', 'amount', 'pipeline', 'dealstage', 'closedate', 'hubspot_owner_id', 'hs_next_activity_date', 'hs_is_closed', 'hs_is_closed_won'],
    breakdowns: [
      {
        key: 'deal-stage',
        label: 'Deal stage',
        expression: (alias) => `COALESCE(NULLIF(${alias}.properties->>'dealstage', ''), 'Unknown')`
      },
      {
        key: 'pipeline',
        label: 'Pipeline',
        expression: (alias) => `COALESCE(NULLIF(${alias}.properties->>'pipeline', ''), 'Unknown')`
      }
    ],
    metrics: [
      metric('open-deals', 'open_deals', 'Open deals', 'Current deals that are not closed.', (a) => `NOT (${closedSql(a)})`, { tone: 'accent' }),
      metric('won-deals', 'won_deals', 'Won deals', 'Deals won in the selected date range.', (a, f, t) => `${wonSql(a)} AND ${periodCondition(`COALESCE(${jsonTimestampSql('closedate', a)}, ${updatedTimestampSql(a)})`, f, t)}`, { tone: 'good' }),
      metric('lost-deals', 'lost_deals', 'Lost deals', 'Deals closed but not won in the selected range.', (a, f, t) => `${closedSql(a)} AND NOT (${wonSql(a)}) AND ${periodCondition(`COALESCE(${jsonTimestampSql('closedate', a)}, ${updatedTimestampSql(a)})`, f, t)}`, { tone: 'critical' }),
      metric('overdue-close', 'overdue_close', 'Overdue close date', 'Open deals whose close date has passed.', (a) => `NOT (${closedSql(a)}) AND ${jsonTimestampSql('closedate', a)} < CURRENT_DATE`, { tone: 'critical' }),
      metric('no-next-activity', 'no_next_activity', 'No next activity', 'Open deals without a planned next activity.', (a) => `NOT (${closedSql(a)}) AND NULLIF(${a}.properties->>'hs_next_activity_date', '') IS NULL`, { tone: 'warning' }),
      metric('open-pipeline', 'open_pipeline', 'Open pipeline', 'Total amount currently exposed in open deals.', (a) => `NOT (${closedSql(a)})`, { aggregate: 'sumAmount', format: 'currency', tone: 'accent' }),
      metric('won-revenue', 'won_revenue', 'Won revenue', 'Revenue from deals won in the selected range.', (a, f, t) => `${wonSql(a)} AND ${periodCondition(`COALESCE(${jsonTimestampSql('closedate', a)}, ${updatedTimestampSql(a)})`, f, t)}`, { aggregate: 'sumAmount', format: 'currency', tone: 'good' }),
      metric('without-contact', 'without_contact', 'Missing contact link', 'Deals not associated to a contact.', (a) => `NOT (${associationExists(a, 'contacts')})`, { tone: 'warning' }),
      metric('without-company', 'without_company', 'Missing company link', 'Deals not associated to a company.', (a) => `NOT (${associationExists(a, 'companies')})`, { tone: 'warning' })
    ]
  },
  calls: {
    label: 'Calls',
    description: 'Call execution, outcome completeness, ownership and association quality.',
    columns: ['hs_call_title', 'hs_call_status', 'hs_call_disposition', 'hs_timestamp', 'hubspot_owner_id', 'hs_activity_assigned_to_user_id'],
    breakdowns: [
      {
        key: 'call-disposition',
        label: 'Call disposition',
        expression: (alias) => `COALESCE(NULLIF(${alias}.properties->>'hs_call_disposition', ''), 'No disposition')`
      },
      {
        key: 'call-status',
        label: 'Call status',
        expression: (alias) => `COALESCE(NULLIF(${alias}.properties->>'hs_call_status', ''), 'Unknown')`
      }
    ],
    metrics: [
      metric('with-disposition', 'with_disposition', 'With disposition', 'Calls where a disposition was recorded.', (a, f, t) => `NULLIF(${a}.properties->>'hs_call_disposition', '') IS NOT NULL AND ${periodCondition(objectTimestampSql('calls', a), f, t)}`, { tone: 'good' }),
      metric('missing-disposition', 'missing_disposition', 'Missing disposition', 'Calls without a recorded disposition.', (a, f, t) => `NULLIF(${a}.properties->>'hs_call_disposition', '') IS NULL AND ${periodCondition(objectTimestampSql('calls', a), f, t)}`, { tone: 'warning' }),
      metric('completed-calls', 'completed_calls', 'Completed calls', 'Calls whose activity status is completed.', (a, f, t) => `UPPER(COALESCE(${a}.properties->>'hs_call_status', '')) IN ('COMPLETED', 'DONE') AND ${periodCondition(objectTimestampSql('calls', a), f, t)}`, { tone: 'good' }),
      metric('without-contact', 'without_contact', 'Missing contact link', 'Calls not associated with a contact.', (a, f, t) => `NOT (${associationExists(a, 'contacts')}) AND ${periodCondition(objectTimestampSql('calls', a), f, t)}`, { tone: 'warning' })
    ]
  },
  meetings: {
    label: 'Meetings',
    description: 'Booked meetings, completion, no-shows, notes and CRM associations.',
    columns: ['hs_meeting_title', 'hs_meeting_outcome', 'hs_meeting_start_time', 'hs_timestamp', 'hubspot_owner_id', 'hs_activity_assigned_to_user_id', 'hs_meeting_body'],
    breakdowns: [
      {
        key: 'meeting-outcome',
        label: 'Meeting outcome',
        expression: (alias) => `COALESCE(NULLIF(${alias}.properties->>'hs_meeting_outcome', ''), 'No outcome')`
      },
      {
        key: 'meeting-type',
        label: 'Meeting type',
        expression: (alias) => `COALESCE(NULLIF(${alias}.properties->>'hs_activity_type', ''), 'General')`
      }
    ],
    metrics: [
      metric('completed-meetings', 'completed_meetings', 'Completed meetings', 'Meetings marked completed in the selected range.', (a, f, t) => `UPPER(COALESCE(${a}.properties->>'hs_meeting_outcome', '')) IN ('COMPLETED', 'DONE') AND ${periodCondition(objectTimestampSql('meetings', a), f, t)}`, { tone: 'good' }),
      metric('no-show-meetings', 'no_show_meetings', 'No-show meetings', 'Meetings marked no-show in the selected range.', (a, f, t) => `UPPER(COALESCE(${a}.properties->>'hs_meeting_outcome', '')) IN ('NO_SHOW', 'NOSHOW', 'NO SHOW') AND ${periodCondition(objectTimestampSql('meetings', a), f, t)}`, { tone: 'critical' }),
      metric('missing-outcome', 'missing_outcome', 'Missing outcome', 'Meetings without an outcome.', (a, f, t) => `NULLIF(${a}.properties->>'hs_meeting_outcome', '') IS NULL AND ${periodCondition(objectTimestampSql('meetings', a), f, t)}`, { tone: 'warning' }),
      metric('missing-notes', 'missing_notes', 'Missing notes', 'Meetings without meeting notes or body.', (a, f, t) => `NULLIF(${a}.properties->>'hs_meeting_body', '') IS NULL AND NULLIF(${a}.properties->>'hs_internal_meeting_notes', '') IS NULL AND ${periodCondition(objectTimestampSql('meetings', a), f, t)}`, { tone: 'warning' }),
      metric('without-contact', 'without_contact', 'Missing contact link', 'Meetings not associated with a contact.', (a, f, t) => `NOT (${associationExists(a, 'contacts')}) AND ${periodCondition(objectTimestampSql('meetings', a), f, t)}`, { tone: 'warning' })
    ]
  },
  tasks: {
    label: 'Tasks',
    description: 'Follow-up workload, completion, overdue execution and ownership.',
    columns: ['hs_task_subject', 'hs_task_status', 'hs_task_priority', 'hs_timestamp', 'hubspot_owner_id', 'hs_activity_assigned_to_user_id'],
    breakdowns: [
      {
        key: 'task-status',
        label: 'Task status',
        expression: (alias) => `COALESCE(NULLIF(${alias}.properties->>'hs_task_status', ''), 'Unknown')`
      },
      {
        key: 'task-priority',
        label: 'Task priority',
        expression: (alias) => `COALESCE(NULLIF(${alias}.properties->>'hs_task_priority', ''), 'Normal')`
      }
    ],
    metrics: [
      metric('open-tasks', 'open_tasks', 'Open tasks', 'Tasks that are not completed.', (a) => `UPPER(COALESCE(${a}.properties->>'hs_task_status', '')) NOT IN ('COMPLETED', 'DONE', 'CLOSED')`, { tone: 'accent' }),
      metric('completed-tasks', 'completed_tasks', 'Completed tasks', 'Tasks completed in the selected range.', (a, f, t) => `UPPER(COALESCE(${a}.properties->>'hs_task_status', '')) IN ('COMPLETED', 'DONE', 'CLOSED') AND ${periodCondition(`COALESCE(${jsonTimestampSql('hs_task_completion_date', a)}, ${objectTimestampSql('tasks', a)})`, f, t)}`, { tone: 'good' }),
      metric('due-today', 'due_today', 'Due today', 'Open tasks due today.', (a) => `UPPER(COALESCE(${a}.properties->>'hs_task_status', '')) NOT IN ('COMPLETED', 'DONE', 'CLOSED') AND ${objectTimestampSql('tasks', a)}::date = CURRENT_DATE`, { tone: 'warning' }),
      metric('overdue-tasks', 'overdue_tasks', 'Overdue tasks', 'Open tasks whose due date has passed.', (a) => `UPPER(COALESCE(${a}.properties->>'hs_task_status', '')) NOT IN ('COMPLETED', 'DONE', 'CLOSED') AND ${objectTimestampSql('tasks', a)}::date < CURRENT_DATE`, { tone: 'critical' }),
      metric('high-priority', 'high_priority', 'High priority', 'Tasks marked high priority.', (a) => `UPPER(COALESCE(${a}.properties->>'hs_task_priority', '')) = 'HIGH'`, { tone: 'warning' }),
      metric('without-contact', 'without_contact', 'Missing contact link', 'Tasks not associated with a contact.', (a) => `NOT (${associationExists(a, 'contacts')})`, { tone: 'warning' })
    ]
  },
  tickets: {
    label: 'Tickets',
    description: 'Support workload, status, priority, ownership and service risk.',
    columns: ['subject', 'content', 'hs_pipeline', 'hs_pipeline_stage', 'hs_ticket_priority', 'hubspot_owner_id', 'closed_date', 'hs_is_closed'],
    breakdowns: [
      {
        key: 'ticket-stage',
        label: 'Ticket stage',
        expression: (alias) => `COALESCE(NULLIF(${alias}.properties->>'hs_pipeline_stage', ''), 'Unknown')`
      },
      {
        key: 'ticket-priority',
        label: 'Ticket priority',
        expression: (alias) => `COALESCE(NULLIF(${alias}.properties->>'hs_ticket_priority', ''), 'Normal')`
      }
    ],
    metrics: [
      metric('open-tickets', 'open_tickets', 'Open tickets', 'Tickets that are not closed.', (a) => `NOT (LOWER(COALESCE(${a}.properties->>'hs_is_closed', 'false')) IN ('true', '1') OR NULLIF(${a}.properties->>'closed_date', '') IS NOT NULL)`, { tone: 'accent' }),
      metric('closed-tickets', 'closed_tickets', 'Closed tickets', 'Tickets closed in the selected range.', (a, f, t) => `(LOWER(COALESCE(${a}.properties->>'hs_is_closed', 'false')) IN ('true', '1') OR NULLIF(${a}.properties->>'closed_date', '') IS NOT NULL) AND ${periodCondition(`COALESCE(${jsonTimestampSql('closed_date', a)}, ${updatedTimestampSql(a)})`, f, t)}`, { tone: 'good' }),
      metric('high-priority', 'high_priority', 'High priority', 'Tickets marked high priority.', (a) => `UPPER(COALESCE(${a}.properties->>'hs_ticket_priority', '')) IN ('HIGH', 'URGENT')`, { tone: 'critical' }),
      metric('missing-priority', 'missing_priority', 'Missing priority', 'Tickets without a priority value.', (a) => `NULLIF(${a}.properties->>'hs_ticket_priority', '') IS NULL`, { tone: 'warning' }),
      metric('without-contact', 'without_contact', 'Missing contact link', 'Tickets not associated with a contact.', (a) => `NOT (${associationExists(a, 'contacts')})`, { tone: 'warning' })
    ]
  }
});

export function normalizeObjectType(value) {
  const objectType = String(value ?? '').trim().toLowerCase();
  if (OBJECT_TYPE_SET.has(objectType)) return objectType;
  const error = new Error(`Unsupported CRM object type: ${objectType || 'empty'}`);
  error.statusCode = 404;
  error.category = 'OBJECT_REPORT_NOT_FOUND';
  throw error;
}

function filtersForObjects(query = {}) {
  const normalized = normalizeReportingFilters(query);
  return {
    from: normalized.from,
    to: normalized.to,
    days: normalized.days,
    ownerId: normalized.ownerId
  };
}

function overviewObjectRows(rows) {
  const byType = new Map(rows.map((row) => [row.object_type, row]));
  return SUPPORTED_OBJECT_TYPES.map((objectType) => {
    const config = OBJECT_CONFIG[objectType];
    const row = byType.get(objectType) ?? {};
    return {
      objectType,
      label: config.label,
      description: config.description,
      total: numeric(row.total),
      createdInPeriod: numeric(row.created_in_period),
      updatedInPeriod: numeric(row.updated_in_period),
      missingOwner: numeric(row.missing_owner)
    };
  });
}

export async function buildObjectReportingOverview(postgres, workspaceId, query = {}) {
  const filters = filtersForObjects(query);
  const result = await postgres.query(
    `SELECT
       r.object_type,
       COUNT(*)::bigint AS total,
       COUNT(*) FILTER (
         WHERE ${universalTimestampSql('r')} >= $2::date
           AND ${universalTimestampSql('r')} < ($3::date + INTERVAL '1 day')
       )::bigint AS created_in_period,
       COUNT(*) FILTER (
         WHERE ${updatedTimestampSql('r')} >= $2::date
           AND ${updatedTimestampSql('r')} < ($3::date + INTERVAL '1 day')
       )::bigint AS updated_in_period,
       COUNT(*) FILTER (WHERE ${ownerSql('r')} IS NULL)::bigint AS missing_owner
     FROM crm_records r
     WHERE r.workspace_id = $1
       AND r.object_type = ANY($4::text[])
       AND r.archived = FALSE
       AND ($5::text IS NULL OR ${ownerSql('r')} = $5)
     GROUP BY r.object_type`,
    [workspaceId, filters.from, filters.to, SUPPORTED_OBJECT_TYPES, filters.ownerId]
  );

  return {
    generatedAt: new Date().toISOString(),
    filters,
    objects: overviewObjectRows(result.rows)
  };
}

function metricSelect(metricDefinition, alias = 'r') {
  const condition = metricDefinition.condition(alias, '$2', '$3');
  if (metricDefinition.aggregate === 'sumAmount') {
    return `COALESCE(SUM(${amountSql(alias)}) FILTER (WHERE ${condition}), 0)::numeric AS ${metricDefinition.sqlAlias}`;
  }
  return `COUNT(*) FILTER (WHERE ${condition})::bigint AS ${metricDefinition.sqlAlias}`;
}

async function detailSummary(postgres, workspaceId, objectType, filters) {
  const config = OBJECT_CONFIG[objectType];
  const timestamp = objectTimestampSql(objectType, 'r');
  const metricSql = config.metrics.map((item) => metricSelect(item)).join(',\n       ');
  const result = await postgres.query(
    `SELECT
       COUNT(*)::bigint AS total,
       COUNT(*) FILTER (WHERE ${periodCondition(timestamp)})::bigint AS created_in_period,
       COUNT(*) FILTER (WHERE ${periodCondition(updatedTimestampSql('r'))})::bigint AS updated_in_period,
       COUNT(*) FILTER (WHERE ${ownerSql('r')} IS NULL)::bigint AS missing_owner,
       ${metricSql}
     FROM crm_records r
     WHERE r.workspace_id = $1
       AND r.object_type = '${objectType}'
       AND r.archived = FALSE
       AND ($4::text IS NULL OR ${ownerSql('r')} = $4)`,
    [workspaceId, filters.from, filters.to, filters.ownerId]
  );

  const row = result.rows[0] ?? {};
  const metrics = [
    {
      key: 'total',
      label: `Total ${config.label.toLowerCase()}`,
      description: `All synchronized ${config.label.toLowerCase()} in this workspace.`,
      value: numeric(row.total),
      format: 'number',
      tone: 'accent'
    },
    {
      key: 'created-in-period',
      label: 'Created in period',
      description: `New ${config.label.toLowerCase()} in the selected date range.`,
      value: numeric(row.created_in_period),
      format: 'number',
      tone: 'good'
    },
    {
      key: 'updated-in-period',
      label: 'Updated in period',
      description: `${config.label} changed in the selected date range.`,
      value: numeric(row.updated_in_period),
      format: 'number',
      tone: 'neutral'
    },
    {
      key: 'missing-owner',
      label: 'Missing owner',
      description: `${config.label} without an assigned CRM owner.`,
      value: numeric(row.missing_owner),
      format: 'number',
      tone: 'warning'
    },
    ...config.metrics.map((item) => ({
      key: item.key,
      label: item.label,
      description: item.description,
      value: numeric(row[item.sqlAlias]),
      format: item.format,
      tone: item.tone
    }))
  ];
  return { metrics, total: numeric(row.total) };
}

async function detailTrend(postgres, workspaceId, objectType, filters) {
  const timestamp = objectTimestampSql(objectType, 'r');
  const result = await postgres.query(
    `WITH dates AS (
       SELECT generate_series($2::date, $3::date, INTERVAL '1 day')::date AS day
     ), records AS (
       SELECT date_trunc('day', ${timestamp})::date AS day, COUNT(*)::bigint AS value
       FROM crm_records r
       WHERE r.workspace_id = $1
         AND r.object_type = '${objectType}'
         AND r.archived = FALSE
         AND ${periodCondition(timestamp)}
         AND ($4::text IS NULL OR ${ownerSql('r')} = $4)
       GROUP BY 1
     )
     SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(records.value, 0)::bigint AS value
     FROM dates d
     LEFT JOIN records ON records.day = d.day
     ORDER BY d.day`,
    [workspaceId, filters.from, filters.to, filters.ownerId]
  );
  return result.rows.map((row) => ({ day: row.day, value: numeric(row.value) }));
}

async function detailBreakdown(postgres, workspaceId, objectType, filters, definition) {
  const expression = definition.expression('r');
  const result = await postgres.query(
    `SELECT ${expression} AS key, COUNT(*)::bigint AS value
     FROM crm_records r
     WHERE r.workspace_id = $1
       AND r.object_type = '${objectType}'
       AND r.archived = FALSE
       AND ($4::text IS NULL OR ${ownerSql('r')} = $4)
     GROUP BY 1
     ORDER BY value DESC, key
     LIMIT 10`,
    [workspaceId, filters.from, filters.to, filters.ownerId]
  );
  return {
    key: definition.key,
    label: definition.label,
    rows: result.rows.map((row) => ({ key: row.key || 'Unknown', value: numeric(row.value) }))
  };
}

export async function buildObjectReportingDetail(postgres, workspaceId, rawObjectType, query = {}) {
  const objectType = normalizeObjectType(rawObjectType);
  const filters = filtersForObjects(query);
  const config = OBJECT_CONFIG[objectType];
  const [summary, trend, ...breakdowns] = await Promise.all([
    detailSummary(postgres, workspaceId, objectType, filters),
    detailTrend(postgres, workspaceId, objectType, filters),
    ...config.breakdowns.map((definition) => detailBreakdown(postgres, workspaceId, objectType, filters, definition))
  ]);

  return {
    generatedAt: new Date().toISOString(),
    filters,
    objectType,
    label: config.label,
    description: config.description,
    total: summary.total,
    metrics: summary.metrics,
    trend,
    breakdowns,
    drilldowns: summary.metrics.map((item) => item.key)
  };
}

function genericDrilldownCondition(reportKey, objectType, alias, fromParam, toParam) {
  if (reportKey === 'total') return 'TRUE';
  if (reportKey === 'created-in-period') return periodCondition(objectTimestampSql(objectType, alias), fromParam, toParam);
  if (reportKey === 'updated-in-period') return periodCondition(updatedTimestampSql(alias), fromParam, toParam);
  if (reportKey === 'missing-owner') return `${ownerSql(alias)} IS NULL`;
  return null;
}

function objectMetricDefinition(objectType, reportKey) {
  return OBJECT_CONFIG[objectType].metrics.find((item) => item.key === reportKey) ?? null;
}

export async function getObjectReportingDrilldown(postgres, workspaceId, rawObjectType, reportKeyValue, query = {}) {
  const objectType = normalizeObjectType(rawObjectType);
  const reportKey = String(reportKeyValue ?? '').trim().toLowerCase();
  const filters = filtersForObjects(query);
  const limit = Math.max(1, Math.min(200, Number(query.limit) || 50));
  const offset = Math.max(0, Number(query.offset) || 0);
  const metricDefinition = objectMetricDefinition(objectType, reportKey);
  const condition = genericDrilldownCondition(reportKey, objectType, 'r', '$3', '$4')
    ?? metricDefinition?.condition('r', '$3', '$4')
    ?? null;

  if (!condition) {
    const error = new Error(`Unknown ${objectType} report: ${reportKey}`);
    error.statusCode = 404;
    error.category = 'OBJECT_REPORT_NOT_FOUND';
    throw error;
  }

  const config = OBJECT_CONFIG[objectType];
  const result = await postgres.query(
    `SELECT r.record_id, r.properties, r.hubspot_created_at, r.hubspot_updated_at, r.synced_at
     FROM crm_records r
     WHERE r.workspace_id = $1
       AND r.object_type = $2
       AND r.archived = FALSE
       AND ($5::text IS NULL OR ${ownerSql('r')} = $5)
       AND (${condition})
     ORDER BY ${updatedTimestampSql('r')} DESC, r.record_id
     LIMIT $6 OFFSET $7`,
    [workspaceId, objectType, filters.from, filters.to, filters.ownerId, limit + 1, offset]
  );
  const rows = result.rows.slice(0, limit);

  return {
    key: reportKey,
    objectType,
    columns: config.columns,
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

export function registerObjectReportingRoutes(app, { postgres, requireAdmin, requireWorkspace }) {
  app.get('/api/v1/workspaces/:workspaceId/analytics/objects', { preHandler: requireAdmin }, async (request) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    return {
      workspace,
      report: await buildObjectReportingOverview(postgres, workspace.id, request.query ?? {})
    };
  });

  app.get('/api/v1/workspaces/:workspaceId/analytics/objects/:objectType', { preHandler: requireAdmin }, async (request) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    return {
      workspace,
      report: await buildObjectReportingDetail(
        postgres,
        workspace.id,
        request.params.objectType,
        request.query ?? {}
      )
    };
  });

  app.get('/api/v1/workspaces/:workspaceId/analytics/objects/:objectType/drilldowns/:reportKey', { preHandler: requireAdmin }, async (request) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    return {
      workspaceId: workspace.id,
      drilldown: await getObjectReportingDrilldown(
        postgres,
        workspace.id,
        request.params.objectType,
        request.params.reportKey,
        request.query ?? {}
      )
    };
  });
}
