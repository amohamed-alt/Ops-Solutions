import { normalizeReportingFilters } from './revenue-reporting.js';

const OBJECT_TYPE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,99}$/i;
const REPORT_KEYS = new Set([
  'total',
  'created-in-period',
  'updated-in-period',
  'missing-owner',
  'with-associations',
  'without-associations'
]);
const MAX_PAGE_SIZE = 500;
const MAX_EXPORT_ROWS = 25_000;

const STANDARD_OBJECT_META = Object.freeze({
  contacts: { label: 'Contacts', category: 'crm' },
  companies: { label: 'Companies', category: 'crm' },
  deals: { label: 'Deals', category: 'revenue' },
  calls: { label: 'Calls', category: 'engagement' },
  meetings: { label: 'Meetings', category: 'engagement' },
  tasks: { label: 'Tasks', category: 'engagement' },
  tickets: { label: 'Tickets', category: 'service' },
  leads: { label: 'Leads', category: 'prospecting' },
  products: { label: 'Products', category: 'commerce' },
  line_items: { label: 'Line items', category: 'commerce' },
  quotes: { label: 'Quotes', category: 'commerce' },
  emails: { label: 'Email engagements', category: 'engagement' }
});

const PREFERRED_COLUMNS = Object.freeze({
  leads: ['hs_lead_name', 'hs_lead_type', 'hs_lead_label', 'hs_pipeline', 'hs_pipeline_stage', 'hubspot_owner_id'],
  products: ['name', 'description', 'price', 'hs_sku', 'hs_cost_of_goods_sold', 'hs_product_type'],
  line_items: ['name', 'quantity', 'price', 'amount', 'hs_sku', 'discount', 'tax'],
  quotes: ['hs_title', 'hs_status', 'hs_expiration_date', 'hs_quote_amount', 'hs_public_url_key', 'hubspot_owner_id'],
  emails: ['hs_email_subject', 'hs_email_status', 'hs_email_direction', 'hs_timestamp', 'hubspot_owner_id'],
  contacts: ['firstname', 'lastname', 'email', 'phone', 'company', 'lifecyclestage', 'hubspot_owner_id'],
  companies: ['name', 'domain', 'industry', 'country', 'account_status', 'hubspot_owner_id'],
  deals: ['dealname', 'amount', 'pipeline', 'dealstage', 'closedate', 'hubspot_owner_id'],
  calls: ['hs_call_title', 'hs_call_status', 'hs_call_disposition', 'hs_timestamp', 'hubspot_owner_id'],
  meetings: ['hs_meeting_title', 'hs_meeting_outcome', 'hs_meeting_start_time', 'hubspot_owner_id'],
  tasks: ['hs_task_subject', 'hs_task_status', 'hs_task_priority', 'hs_timestamp', 'hubspot_owner_id'],
  tickets: ['subject', 'hs_pipeline_stage', 'hs_ticket_priority', 'closed_date', 'hubspot_owner_id']
});

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function titleCase(value) {
  return String(value || '')
    .replace(/^\d+-/, '')
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function normalizeExtendedObjectType(value) {
  const objectType = String(value ?? '').trim().toLowerCase();
  if (!OBJECT_TYPE_PATTERN.test(objectType)) {
    const error = new Error('CRM object type is invalid.');
    error.statusCode = 400;
    error.category = 'INVALID_OBJECT_TYPE';
    throw error;
  }
  return objectType;
}

function normalizeObjectFilters(query = {}) {
  const filters = normalizeReportingFilters(query);
  return {
    from: filters.from,
    to: filters.to,
    days: filters.days,
    ownerId: filters.ownerId,
    search: String(query.search ?? '').trim().slice(0, 200),
    limit: Math.max(1, Math.min(MAX_PAGE_SIZE, Number(query.limit) || 50)),
    offset: Math.max(0, Number(query.offset) || 0),
    sort: ['created', 'id'].includes(String(query.sort)) ? String(query.sort) : 'updated',
    order: String(query.order).toLowerCase() === 'asc' ? 'asc' : 'desc'
  };
}

function createdTimestampSql(alias = 'r') {
  return `COALESCE(${alias}.hubspot_created_at, ${alias}.synced_at)`;
}

function updatedTimestampSql(alias = 'r') {
  return `COALESCE(${alias}.hubspot_updated_at, ${alias}.hubspot_created_at, ${alias}.synced_at)`;
}

function ownerSql(alias = 'r') {
  return `COALESCE(
    NULLIF(${alias}.properties->>'hubspot_owner_id', ''),
    NULLIF(${alias}.properties->>'hs_activity_assigned_to_user_id', ''),
    NULLIF(${alias}.properties->>'hs_created_by_user_id', '')
  )`;
}

function associationExistsSql(alias = 'r') {
  return `EXISTS (
    SELECT 1 FROM crm_record_associations a
    WHERE a.workspace_id = ${alias}.workspace_id
      AND (
        (a.from_object_type = ${alias}.object_type AND a.from_record_id = ${alias}.record_id)
        OR (a.to_object_type = ${alias}.object_type AND a.to_record_id = ${alias}.record_id)
      )
  )`;
}

function reportCondition(reportKey, alias = 'r', fromParam = '$3', toParam = '$4') {
  if (!REPORT_KEYS.has(reportKey)) return null;
  if (reportKey === 'total') return 'TRUE';
  if (reportKey === 'created-in-period') {
    return `${createdTimestampSql(alias)} >= ${fromParam}::date AND ${createdTimestampSql(alias)} < (${toParam}::date + INTERVAL '1 day')`;
  }
  if (reportKey === 'updated-in-period') {
    return `${updatedTimestampSql(alias)} >= ${fromParam}::date AND ${updatedTimestampSql(alias)} < (${toParam}::date + INTERVAL '1 day')`;
  }
  if (reportKey === 'missing-owner') return `${ownerSql(alias)} IS NULL`;
  if (reportKey === 'with-associations') return associationExistsSql(alias);
  return `NOT (${associationExistsSql(alias)})`;
}

async function tableExists(postgres, tableName) {
  const result = await postgres.query('SELECT to_regclass($1) AS table_name', [`public.${tableName}`]);
  return Boolean(result.rows[0]?.table_name);
}

async function discoveredPropertyNames(postgres, workspaceId, objectType) {
  if (!await tableExists(postgres, 'crm_properties')) return [];
  const result = await postgres.query(
    `SELECT property_name
     FROM crm_properties
     WHERE workspace_id = $1 AND object_type = $2
     ORDER BY property_name
     LIMIT 200`,
    [workspaceId, objectType]
  );
  return result.rows
    .map((row) => String(row.property_name ?? '').trim())
    .filter((name) => /^[a-z0-9_]{1,120}$/i.test(name));
}

async function selectedColumns(postgres, workspaceId, objectType) {
  const discovered = await discoveredPropertyNames(postgres, workspaceId, objectType);
  const discoveredSet = new Set(discovered);
  const preferred = (PREFERRED_COLUMNS[objectType] ?? []).filter((name) => discovered.length === 0 || discoveredSet.has(name));
  const fallback = discovered.filter((name) => !preferred.includes(name));
  return [...preferred, ...fallback].slice(0, 24);
}

async function assertObjectAvailable(postgres, workspaceId, objectType) {
  const result = await postgres.query(
    `SELECT EXISTS (
       SELECT 1 FROM crm_records WHERE workspace_id = $1 AND object_type = $2
     ) AS synchronized`,
    [workspaceId, objectType]
  );
  if (result.rows[0]?.synchronized) return;
  const discovered = await discoveredPropertyNames(postgres, workspaceId, objectType);
  if (discovered.length > 0) return;
  const error = new Error(`CRM object ${objectType} is not synchronized or discovered for this workspace.`);
  error.statusCode = 404;
  error.category = 'OBJECT_NOT_AVAILABLE';
  throw error;
}

export async function buildExtendedObjectCatalog(postgres, workspaceId) {
  const recordResult = await postgres.query(
    `SELECT object_type,
            COUNT(*) FILTER (WHERE archived = FALSE)::bigint AS total,
            MAX(synced_at) AS newest_sync
     FROM crm_records
     WHERE workspace_id = $1
     GROUP BY object_type
     ORDER BY object_type`,
    [workspaceId]
  );

  const propertyCounts = new Map();
  if (await tableExists(postgres, 'crm_properties')) {
    const propertyResult = await postgres.query(
      `SELECT object_type, COUNT(*)::int AS property_count
       FROM crm_properties
       WHERE workspace_id = $1
       GROUP BY object_type`,
      [workspaceId]
    );
    for (const row of propertyResult.rows) propertyCounts.set(String(row.object_type), numeric(row.property_count));
  }

  const byType = new Map();
  for (const row of recordResult.rows) {
    byType.set(String(row.object_type), {
      total: numeric(row.total),
      newestSync: row.newest_sync ?? null
    });
  }
  for (const objectType of propertyCounts.keys()) {
    if (!byType.has(objectType)) byType.set(objectType, { total: 0, newestSync: null });
  }

  const objects = [...byType.entries()]
    .filter(([objectType]) => OBJECT_TYPE_PATTERN.test(objectType))
    .map(([objectType, state]) => {
      const meta = STANDARD_OBJECT_META[objectType] ?? null;
      return {
        objectType,
        label: meta?.label ?? titleCase(objectType),
        category: meta?.category ?? 'custom',
        standard: Boolean(meta),
        custom: !meta,
        synchronized: state.total > 0,
        total: state.total,
        propertyCount: propertyCounts.get(objectType) ?? 0,
        newestSync: state.newestSync
      };
    })
    .sort((left, right) => {
      if (left.synchronized !== right.synchronized) return left.synchronized ? -1 : 1;
      if (left.standard !== right.standard) return left.standard ? -1 : 1;
      return left.label.localeCompare(right.label);
    });

  return { generatedAt: new Date().toISOString(), objects };
}

function dimensionCandidates(columns) {
  const priorities = [
    'hs_pipeline_stage', 'dealstage', 'pipeline', 'lifecyclestage', 'hs_lead_status',
    'hs_status', 'status', 'hs_ticket_priority', 'industry', 'country', 'hubspot_owner_id'
  ];
  return priorities.filter((name) => columns.includes(name)).slice(0, 2);
}

async function dimensionBreakdown(postgres, workspaceId, objectType, propertyName, ownerId) {
  const result = await postgres.query(
    `SELECT COALESCE(NULLIF(jsonb_extract_path_text(r.properties, $3), ''), 'Unknown') AS key,
            COUNT(*)::bigint AS value
     FROM crm_records r
     WHERE r.workspace_id = $1
       AND r.object_type = $2
       AND r.archived = FALSE
       AND ($4::text IS NULL OR ${ownerSql('r')} = $4)
     GROUP BY 1
     ORDER BY value DESC, key
     LIMIT 12`,
    [workspaceId, objectType, propertyName, ownerId]
  );
  return {
    key: propertyName,
    label: titleCase(propertyName),
    rows: result.rows.map((row) => ({ key: row.key, value: numeric(row.value) }))
  };
}

export async function buildExtendedObjectDetail(postgres, workspaceId, rawObjectType, query = {}) {
  const objectType = normalizeExtendedObjectType(rawObjectType);
  await assertObjectAvailable(postgres, workspaceId, objectType);
  const filters = normalizeObjectFilters(query);
  const columns = await selectedColumns(postgres, workspaceId, objectType);
  const summaryResult = await postgres.query(
    `SELECT COUNT(*) FILTER (WHERE archived = FALSE)::bigint AS total,
            COUNT(*) FILTER (
              WHERE archived = FALSE
                AND ${createdTimestampSql('r')} >= $3::date
                AND ${createdTimestampSql('r')} < ($4::date + INTERVAL '1 day')
            )::bigint AS created_in_period,
            COUNT(*) FILTER (
              WHERE archived = FALSE
                AND ${updatedTimestampSql('r')} >= $3::date
                AND ${updatedTimestampSql('r')} < ($4::date + INTERVAL '1 day')
            )::bigint AS updated_in_period,
            COUNT(*) FILTER (WHERE archived = FALSE AND ${ownerSql('r')} IS NULL)::bigint AS missing_owner,
            COUNT(*) FILTER (WHERE archived = FALSE AND ${associationExistsSql('r')})::bigint AS with_associations,
            COUNT(*) FILTER (WHERE archived = FALSE AND NOT (${associationExistsSql('r')}))::bigint AS without_associations
     FROM crm_records r
     WHERE r.workspace_id = $1
       AND r.object_type = $2
       AND ($5::text IS NULL OR ${ownerSql('r')} = $5)`,
    [workspaceId, objectType, filters.from, filters.to, filters.ownerId]
  );
  const row = summaryResult.rows[0] ?? {};
  const total = numeric(row.total);

  const trendResult = await postgres.query(
    `WITH dates AS (
       SELECT generate_series($3::date, $4::date, INTERVAL '1 day')::date AS day
     ), records AS (
       SELECT date_trunc('day', ${createdTimestampSql('r')})::date AS day, COUNT(*)::bigint AS value
       FROM crm_records r
       WHERE r.workspace_id = $1 AND r.object_type = $2 AND r.archived = FALSE
         AND ${createdTimestampSql('r')} >= $3::date
         AND ${createdTimestampSql('r')} < ($4::date + INTERVAL '1 day')
         AND ($5::text IS NULL OR ${ownerSql('r')} = $5)
       GROUP BY 1
     )
     SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(records.value, 0)::bigint AS value
     FROM dates d LEFT JOIN records ON records.day = d.day ORDER BY d.day`,
    [workspaceId, objectType, filters.from, filters.to, filters.ownerId]
  );

  const breakdowns = await Promise.all(
    dimensionCandidates(columns).map((property) => dimensionBreakdown(postgres, workspaceId, objectType, property, filters.ownerId))
  );
  const meta = STANDARD_OBJECT_META[objectType] ?? null;

  return {
    generatedAt: new Date().toISOString(),
    filters,
    objectType,
    label: meta?.label ?? titleCase(objectType),
    category: meta?.category ?? 'custom',
    custom: !meta,
    total,
    columns,
    metrics: [
      { key: 'total', label: 'Total records', description: 'All active synchronized records.', value: total, tone: 'accent' },
      { key: 'created-in-period', label: 'Created in period', description: 'Records created in the selected date range.', value: numeric(row.created_in_period), tone: 'good' },
      { key: 'updated-in-period', label: 'Updated in period', description: 'Records updated in the selected date range.', value: numeric(row.updated_in_period), tone: 'neutral' },
      { key: 'missing-owner', label: 'Missing owner', description: 'Records without an assigned CRM owner.', value: numeric(row.missing_owner), tone: 'warning' },
      { key: 'with-associations', label: 'With associations', description: 'Records connected to at least one CRM record.', value: numeric(row.with_associations), tone: 'good' },
      { key: 'without-associations', label: 'Without associations', description: 'Records not connected to another CRM object.', value: numeric(row.without_associations), tone: 'warning' }
    ],
    trend: trendResult.rows.map((item) => ({ day: item.day, value: numeric(item.value) })),
    breakdowns
  };
}

function searchClause(filters, paramNumber = 6) {
  if (!filters.search) return { sql: 'TRUE', values: [] };
  return {
    sql: `(r.record_id ILIKE $${paramNumber} OR r.properties::text ILIKE $${paramNumber})`,
    values: [`%${filters.search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`]
  };
}

function orderSql(filters) {
  const expression = filters.sort === 'created'
    ? createdTimestampSql('r')
    : filters.sort === 'id'
      ? 'r.record_id'
      : updatedTimestampSql('r');
  return `${expression} ${filters.order === 'asc' ? 'ASC' : 'DESC'}, r.record_id ${filters.order === 'asc' ? 'ASC' : 'DESC'}`;
}

export async function searchExtendedObjectRecords(postgres, workspaceId, rawObjectType, rawReportKey, query = {}) {
  const objectType = normalizeExtendedObjectType(rawObjectType);
  const reportKey = String(rawReportKey ?? 'total').trim().toLowerCase();
  await assertObjectAvailable(postgres, workspaceId, objectType);
  const condition = reportCondition(reportKey, 'r', '$3', '$4');
  if (!condition) {
    const error = new Error(`Unknown generic object report: ${reportKey}`);
    error.statusCode = 404;
    error.category = 'OBJECT_REPORT_NOT_FOUND';
    throw error;
  }
  const filters = normalizeObjectFilters(query);
  const search = searchClause(filters, 6);
  const values = [workspaceId, objectType, filters.from, filters.to, filters.ownerId, ...search.values, filters.limit + 1, filters.offset];
  const limitParam = search.values.length ? '$7' : '$6';
  const offsetParam = search.values.length ? '$8' : '$7';
  const result = await postgres.query(
    `SELECT r.record_id, r.properties, r.hubspot_created_at, r.hubspot_updated_at, r.synced_at,
            COUNT(*) OVER()::bigint AS matching_total
     FROM crm_records r
     WHERE r.workspace_id = $1 AND r.object_type = $2 AND r.archived = FALSE
       AND ($5::text IS NULL OR ${ownerSql('r')} = $5)
       AND (${condition})
       AND (${search.sql})
     ORDER BY ${orderSql(filters)}
     LIMIT ${limitParam} OFFSET ${offsetParam}`,
    values
  );
  const rows = result.rows.slice(0, filters.limit);
  const columns = await selectedColumns(postgres, workspaceId, objectType);
  return {
    key: reportKey,
    objectType,
    columns,
    limit: filters.limit,
    offset: filters.offset,
    total: numeric(result.rows[0]?.matching_total),
    hasMore: result.rows.length > filters.limit,
    search: filters.search,
    sort: filters.sort,
    order: filters.order,
    results: rows.map((row) => ({
      id: row.record_id,
      properties: row.properties ?? {},
      hubspotCreatedAt: row.hubspot_created_at,
      hubspotUpdatedAt: row.hubspot_updated_at,
      syncedAt: row.synced_at
    }))
  };
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replaceAll('"', '""').replace(/[\r\n]+/g, ' ')}"`;
}

export async function exportExtendedObjectCsv(postgres, workspaceId, rawObjectType, rawReportKey, query = {}) {
  const objectType = normalizeExtendedObjectType(rawObjectType);
  const reportKey = String(rawReportKey ?? 'total').trim().toLowerCase();
  await assertObjectAvailable(postgres, workspaceId, objectType);
  const condition = reportCondition(reportKey, 'r', '$3', '$4');
  if (!condition) {
    const error = new Error(`Unknown generic object report: ${reportKey}`);
    error.statusCode = 404;
    error.category = 'OBJECT_REPORT_NOT_FOUND';
    throw error;
  }
  const filters = normalizeObjectFilters(query);
  const requestedLimit = Math.max(1, Math.min(MAX_EXPORT_ROWS, Number(query.exportLimit) || MAX_EXPORT_ROWS));
  const columns = await selectedColumns(postgres, workspaceId, objectType);
  const search = searchClause(filters, 6);
  const values = [workspaceId, objectType, filters.from, filters.to, filters.ownerId, ...search.values, requestedLimit];
  const limitParam = search.values.length ? '$7' : '$6';
  const result = await postgres.query(
    `SELECT r.record_id, r.properties, r.hubspot_created_at, r.hubspot_updated_at, r.synced_at
     FROM crm_records r
     WHERE r.workspace_id = $1 AND r.object_type = $2 AND r.archived = FALSE
       AND ($5::text IS NULL OR ${ownerSql('r')} = $5)
       AND (${condition})
       AND (${search.sql})
     ORDER BY ${orderSql(filters)}
     LIMIT ${limitParam}`,
    values
  );
  const header = ['record_id', ...columns, 'hubspot_created_at', 'hubspot_updated_at', 'synced_at'];
  const lines = [header.map(csvCell).join(',')];
  for (const row of result.rows) {
    lines.push([
      row.record_id,
      ...columns.map((column) => row.properties?.[column] ?? ''),
      row.hubspot_created_at ?? '',
      row.hubspot_updated_at ?? '',
      row.synced_at ?? ''
    ].map(csvCell).join(','));
  }
  return {
    csv: `${lines.join('\n')}\n`,
    rowCount: result.rows.length,
    truncated: result.rows.length >= requestedLimit,
    filename: `${objectType}-${reportKey}-${filters.from}-${filters.to}.csv`
  };
}
