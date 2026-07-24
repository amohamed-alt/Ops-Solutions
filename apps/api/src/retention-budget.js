const MIGRATION_VERSION = 31;
const MIGRATION_LOCK = 812341261;
const MAX_CSV_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 20_000;
const MAX_ERRORS = 200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REQUIRED_FIELDS = ['companyName', 'product', 'budgetMonth', 'renewalValue'];
const OPTIONAL_FIELDS = [
  'companyDomain', 'bookedValue', 'cashCollected', 'rmCsm', 'expectedLost',
  'accountStatus', 'notes'
];
const ALL_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];
const CATEGORIES = new Set(['all', 'upcoming', 'delayed', 'renewed_late', 'lost', 'matched', 'unmatched']);

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS retention_budget_imports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    uploaded_by_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
    file_name TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL CHECK (status IN ('validated','imported','active','archived','failed')),
    active BOOLEAN NOT NULL DEFAULT FALSE,
    column_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
    row_count INTEGER NOT NULL DEFAULT 0,
    valid_row_count INTEGER NOT NULL DEFAULT 0,
    rejected_row_count INTEGER NOT NULL DEFAULT 0,
    duplicate_row_count INTEGER NOT NULL DEFAULT 0,
    matched_company_count INTEGER NOT NULL DEFAULT 0,
    matched_deal_count INTEGER NOT NULL DEFAULT 0,
    validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
    source_digest TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS retention_budget_rows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    import_id UUID NOT NULL REFERENCES retention_budget_imports(id) ON DELETE CASCADE,
    source_row_number INTEGER NOT NULL,
    company_name TEXT NOT NULL,
    company_domain TEXT,
    company_key TEXT NOT NULL,
    product TEXT NOT NULL,
    product_key TEXT NOT NULL,
    budget_month DATE NOT NULL,
    renewal_value NUMERIC(18,2) NOT NULL DEFAULT 0,
    booked_value NUMERIC(18,2) NOT NULL DEFAULT 0,
    cash_collected NUMERIC(18,2) NOT NULL DEFAULT 0,
    rm_csm TEXT,
    expected_lost BOOLEAN NOT NULL DEFAULT FALSE,
    account_status TEXT,
    notes TEXT,
    matched_company_id TEXT,
    matched_deal_id TEXT,
    match_status TEXT NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched','company_matched','deal_matched')),
    duplicate_count INTEGER NOT NULL DEFAULT 1,
    raw JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(import_id, company_key, product_key, budget_month)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS retention_budget_one_active_import_idx
    ON retention_budget_imports(workspace_id) WHERE active = TRUE;
  CREATE INDEX IF NOT EXISTS retention_budget_imports_workspace_idx
    ON retention_budget_imports(workspace_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS retention_budget_rows_workspace_month_idx
    ON retention_budget_rows(workspace_id, budget_month, product_key);
  CREATE INDEX IF NOT EXISTS retention_budget_rows_company_idx
    ON retention_budget_rows(workspace_id, matched_company_id);
`;

function retentionError(message, category = 'RETENTION_BUDGET_INVALID', statusCode = 400, details = undefined) {
  const error = new Error(message);
  error.category = category;
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function requireManager(request) {
  if (!['owner', 'admin'].includes(String(request.workspaceMembership?.role || ''))) {
    throw retentionError('Admin or owner access is required.', 'WORKSPACE_ROLE_REQUIRED', 403);
  }
}

function safeText(value, max = 500) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function normalizeKey(value) {
  return safeText(value, 500).toLowerCase().replace(/[^a-z0-9\p{L}\p{N}]+/gu, ' ').trim();
}

function normalizeDomain(value) {
  const text = safeText(value, 300).toLowerCase();
  if (!text) return '';
  try {
    const url = new URL(text.includes('://') ? text : `https://${text}`);
    return url.hostname.replace(/^www\./, '').slice(0, 255);
  } catch {
    return text.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].slice(0, 255);
  }
}

function parseMoney(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100) / 100;
  const cleaned = String(value ?? '').replace(/[\s,]/g, '').replace(/[^0-9.\-]/g, '');
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) throw new Error('must be a valid amount');
  return Math.round(parsed * 100) / 100;
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'y', 'lost', 'expected'].includes(String(value ?? '').trim().toLowerCase());
}

function parseMonth(value) {
  const text = String(value ?? '').trim();
  let match = text.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/);
  if (!match) {
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) throw new Error('must be a valid month or date');
    match = [text, String(date.getUTCFullYear()), String(date.getUTCMonth() + 1)];
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > 2200 || month < 1 || month > 12) throw new Error('must be between 2000-01 and 2200-12');
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

export function parseRetentionCsv(csv) {
  const source = String(csv ?? '').replace(/^\uFEFF/, '');
  if (!source.trim()) throw retentionError('CSV content is empty.');
  if (Buffer.byteLength(source, 'utf8') > MAX_CSV_BYTES) throw retentionError('CSV exceeds the safe 8 MiB upload limit.', 'RETENTION_BUDGET_TOO_LARGE', 413);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(cell); cell = ''; }
    else if (character === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += character;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  if (rows.length < 2) throw retentionError('CSV must contain a header and at least one data row.');
  const headers = rows[0].map((value, index) => safeText(value, 200) || `column_${index + 1}`);
  const data = rows.slice(1).filter((values) => values.some((value) => safeText(value))).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
  if (data.length > MAX_ROWS) throw retentionError(`CSV cannot exceed ${MAX_ROWS} data rows.`, 'RETENTION_BUDGET_TOO_LARGE', 413);
  return { headers, rows: data };
}

function normalizeMapping(mapping, headers) {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw retentionError('Column mapping is required.');
  const headerSet = new Set(headers);
  const normalized = {};
  for (const field of ALL_FIELDS) {
    const column = safeText(mapping[field], 200);
    if (column && !headerSet.has(column)) throw retentionError(`Mapped column “${column}” does not exist.`, 'RETENTION_COLUMN_NOT_FOUND');
    normalized[field] = column || null;
  }
  for (const field of REQUIRED_FIELDS) {
    if (!normalized[field]) throw retentionError(`Map the required ${field} field.`, 'RETENTION_REQUIRED_COLUMN_MISSING');
  }
  return normalized;
}

function valueFor(row, mapping, field) {
  const column = mapping[field];
  return column ? row[column] : '';
}

export function validateRetentionRows(rows, mapping, { currency = 'USD' } = {}) {
  const errors = [];
  const deduplicated = new Map();
  let rejected = 0;
  let duplicateCount = 0;
  rows.forEach((raw, index) => {
    const sourceRowNumber = index + 2;
    try {
      const companyName = safeText(valueFor(raw, mapping, 'companyName'), 240);
      const companyDomain = normalizeDomain(valueFor(raw, mapping, 'companyDomain'));
      const product = safeText(valueFor(raw, mapping, 'product'), 240);
      const budgetMonth = parseMonth(valueFor(raw, mapping, 'budgetMonth'));
      const renewalValue = parseMoney(valueFor(raw, mapping, 'renewalValue'));
      const bookedValue = parseMoney(valueFor(raw, mapping, 'bookedValue'));
      const cashCollected = parseMoney(valueFor(raw, mapping, 'cashCollected'));
      if (!companyName) throw new Error('company name is required');
      if (!product) throw new Error('product is required');
      if (renewalValue < 0 || bookedValue < 0 || cashCollected < 0) throw new Error('amounts cannot be negative');
      const companyKey = companyDomain ? `domain:${companyDomain}` : `name:${normalizeKey(companyName)}`;
      const productKey = normalizeKey(product);
      const dedupeKey = `${companyKey}|${productKey}|${budgetMonth}`;
      const normalized = {
        sourceRowNumber,
        companyName,
        companyDomain: companyDomain || null,
        companyKey,
        product,
        productKey,
        budgetMonth,
        renewalValue,
        bookedValue,
        cashCollected,
        rmCsm: safeText(valueFor(raw, mapping, 'rmCsm'), 240) || null,
        expectedLost: parseBoolean(valueFor(raw, mapping, 'expectedLost')),
        accountStatus: safeText(valueFor(raw, mapping, 'accountStatus'), 120) || null,
        notes: safeText(valueFor(raw, mapping, 'notes'), 2000) || null,
        duplicateCount: 1,
        raw
      };
      if (deduplicated.has(dedupeKey)) {
        const existing = deduplicated.get(dedupeKey);
        existing.renewalValue += normalized.renewalValue;
        existing.bookedValue += normalized.bookedValue;
        existing.cashCollected += normalized.cashCollected;
        existing.expectedLost ||= normalized.expectedLost;
        existing.duplicateCount += 1;
        duplicateCount += 1;
      } else {
        deduplicated.set(dedupeKey, normalized);
      }
    } catch (error) {
      rejected += 1;
      if (errors.length < MAX_ERRORS) errors.push({ row: sourceRowNumber, message: safeText(error.message, 500) });
    }
  });
  const normalizedCurrency = safeText(currency, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) throw retentionError('Currency must be a three-letter ISO code.');
  return {
    currency: normalizedCurrency,
    totalRows: rows.length,
    validRows: [...deduplicated.values()],
    validRowCount: deduplicated.size,
    rejectedRowCount: rejected,
    duplicateRowCount: duplicateCount,
    errors
  };
}

export async function ensureRetentionBudgetSchema(postgres) {
  const client = await postgres.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${MIGRATION_LOCK})`);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    const existing = await client.query('SELECT 1 FROM schema_migrations WHERE version=$1', [MIGRATION_VERSION]);
    if (existing.rowCount === 0) {
      await client.query('BEGIN');
      try {
        await client.query(SCHEMA_SQL);
        await client.query('INSERT INTO schema_migrations(version,name) VALUES($1,$2)', [MIGRATION_VERSION, 'retention_budget_import_and_matching']);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return { applied: existing.rowCount === 0, version: MIGRATION_VERSION };
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${MIGRATION_LOCK})`).catch(() => undefined);
    client.release();
  }
}

async function matchImport(postgres, workspaceId, importId) {
  await postgres.query(
    `UPDATE retention_budget_rows b SET matched_company_id=(
       SELECT c.record_id FROM crm_records c
       WHERE c.workspace_id=b.workspace_id AND c.object_type='companies' AND c.archived=FALSE
         AND ((b.company_domain IS NOT NULL AND LOWER(COALESCE(c.properties->>'domain',''))=LOWER(b.company_domain))
           OR LOWER(COALESCE(c.properties->>'name',''))=LOWER(b.company_name))
       ORDER BY CASE WHEN b.company_domain IS NOT NULL AND LOWER(COALESCE(c.properties->>'domain',''))=LOWER(b.company_domain) THEN 0 ELSE 1 END,
                c.hubspot_updated_at DESC NULLS LAST LIMIT 1
     ) WHERE b.workspace_id=$1 AND b.import_id=$2`,
    [workspaceId, importId]
  );

  await postgres.query(
    `WITH product_mapping AS (
       SELECT property_name FROM property_mappings
       WHERE workspace_id=$1 AND semantic_key='product' AND object_type='deals' LIMIT 1
     )
     UPDATE retention_budget_rows b SET matched_deal_id=(
       SELECT d.record_id FROM crm_records d
       JOIN crm_record_associations a ON a.workspace_id=d.workspace_id
         AND a.from_object_type='deals' AND a.from_record_id=d.record_id
         AND a.to_object_type='companies' AND a.to_record_id=b.matched_company_id
       CROSS JOIN product_mapping pm
       WHERE d.workspace_id=b.workspace_id AND d.object_type='deals' AND d.archived=FALSE
         AND LOWER(COALESCE(jsonb_extract_path_text(d.properties,pm.property_name),''))=LOWER(b.product)
       ORDER BY d.hubspot_updated_at DESC NULLS LAST LIMIT 1
     ) WHERE b.workspace_id=$1 AND b.import_id=$2 AND b.matched_company_id IS NOT NULL`,
    [workspaceId, importId]
  );

  const result = await postgres.query(
    `UPDATE retention_budget_rows SET match_status=CASE
       WHEN matched_deal_id IS NOT NULL THEN 'deal_matched'
       WHEN matched_company_id IS NOT NULL THEN 'company_matched'
       ELSE 'unmatched' END
     WHERE workspace_id=$1 AND import_id=$2
     RETURNING match_status`,
    [workspaceId, importId]
  );
  const companyMatched = result.rows.filter((row) => row.match_status !== 'unmatched').length;
  const dealMatched = result.rows.filter((row) => row.match_status === 'deal_matched').length;
  await postgres.query(
    `UPDATE retention_budget_imports SET matched_company_count=$3,matched_deal_count=$4,updated_at=NOW()
     WHERE workspace_id=$1 AND id=$2`,
    [workspaceId, importId, companyMatched, dealMatched]
  );
  return { companyMatched, dealMatched };
}

function importPayload(body) {
  const csv = String(body?.csv ?? '');
  const parsed = parseRetentionCsv(csv);
  const mapping = normalizeMapping(body?.mapping, parsed.headers);
  const validation = validateRetentionRows(parsed.rows, mapping, { currency: body?.currency || 'USD' });
  return {
    fileName: safeText(body?.fileName || 'retention-budget.csv', 240),
    headers: parsed.headers,
    mapping,
    validation,
    activate: body?.activate !== false
  };
}

function serializeImport(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    fileName: row.file_name,
    currency: row.currency,
    status: row.status,
    active: row.active,
    columnMapping: row.column_mapping ?? {},
    rowCount: row.row_count,
    validRowCount: row.valid_row_count,
    rejectedRowCount: row.rejected_row_count,
    duplicateRowCount: row.duplicate_row_count,
    matchedCompanyCount: row.matched_company_count,
    matchedDealCount: row.matched_deal_count,
    validationErrors: row.validation_errors ?? [],
    createdAt: row.created_at,
    activatedAt: row.activated_at,
    updatedAt: row.updated_at
  };
}

async function activeImport(postgres, workspaceId) {
  const result = await postgres.query('SELECT * FROM retention_budget_imports WHERE workspace_id=$1 AND active=TRUE LIMIT 1', [workspaceId]);
  return result.rows[0] ?? null;
}

function reportFilters(query = {}) {
  const category = String(query.category || 'all').toLowerCase();
  if (!CATEGORIES.has(category)) throw retentionError('Unknown retention category.');
  return {
    category,
    product: safeText(query.product, 240) || null,
    rmCsm: safeText(query.rmCsm, 240) || null,
    accountStatus: safeText(query.accountStatus, 120) || null,
    fromMonth: query.fromMonth ? parseMonth(query.fromMonth) : null,
    toMonth: query.toMonth ? parseMonth(query.toMonth) : null,
    limit: Math.max(1, Math.min(200, Number(query.limit) || 50)),
    offset: Math.max(0, Number(query.offset) || 0)
  };
}

function categorySql(category) {
  if (category === 'lost') return `(expected_lost=TRUE OR LOWER(COALESCE(account_status,'')) IN ('lost','churned','closed lost'))`;
  if (category === 'renewed_late') return `(budget_month < date_trunc('month',CURRENT_DATE)::date AND booked_value+cash_collected>0 AND NOT expected_lost)`;
  if (category === 'delayed') return `(budget_month < date_trunc('month',CURRENT_DATE)::date AND booked_value+cash_collected=0 AND NOT expected_lost AND LOWER(COALESCE(account_status,'')) NOT IN ('lost','churned','closed lost'))`;
  if (category === 'upcoming') return `(budget_month >= date_trunc('month',CURRENT_DATE)::date AND booked_value+cash_collected=0 AND NOT expected_lost)`;
  if (category === 'matched') return `match_status<>'unmatched'`;
  if (category === 'unmatched') return `match_status='unmatched'`;
  return 'TRUE';
}

export async function buildRetentionBudgetReport(postgres, workspaceId, query = {}) {
  const current = await activeImport(postgres, workspaceId);
  if (!current) return { configured: false, import: null, filters: reportFilters(query), summary: {}, breakdowns: {}, rows: [], total: 0 };
  const filters = reportFilters(query);
  const values = [workspaceId, current.id, filters.product, filters.rmCsm, filters.accountStatus, filters.fromMonth, filters.toMonth, filters.limit + 1, filters.offset];
  const where = `workspace_id=$1 AND import_id=$2
    AND ($3::text IS NULL OR LOWER(product)=LOWER($3))
    AND ($4::text IS NULL OR LOWER(COALESCE(rm_csm,''))=LOWER($4))
    AND ($5::text IS NULL OR LOWER(COALESCE(account_status,''))=LOWER($5))
    AND ($6::date IS NULL OR budget_month >= $6)
    AND ($7::date IS NULL OR budget_month <= $7)`;
  const [summary, products, managers, months, rows, notInBudget] = await Promise.all([
    postgres.query(
      `SELECT COUNT(*)::bigint AS accounts,
        COALESCE(SUM(renewal_value),0)::numeric AS renewal_value,
        COALESCE(SUM(booked_value),0)::numeric AS booked_value,
        COALESCE(SUM(cash_collected),0)::numeric AS cash_collected,
        COALESCE(SUM(GREATEST(renewal_value-cash_collected,0)),0)::numeric AS remaining_collection,
        COUNT(*) FILTER(WHERE ${categorySql('upcoming')})::bigint AS upcoming,
        COUNT(*) FILTER(WHERE ${categorySql('delayed')})::bigint AS delayed,
        COUNT(*) FILTER(WHERE ${categorySql('renewed_late')})::bigint AS renewed_late,
        COUNT(*) FILTER(WHERE ${categorySql('lost')})::bigint AS lost,
        COUNT(*) FILTER(WHERE match_status='unmatched')::bigint AS unmatched
       FROM retention_budget_rows WHERE ${where}`,
      values.slice(0, 7)
    ),
    postgres.query(`SELECT product AS key,COUNT(*)::bigint AS accounts,COALESCE(SUM(renewal_value),0)::numeric AS value FROM retention_budget_rows WHERE ${where} GROUP BY product ORDER BY value DESC LIMIT 30`, values.slice(0, 7)),
    postgres.query(`SELECT COALESCE(rm_csm,'Unassigned') AS key,COUNT(*)::bigint AS accounts,COALESCE(SUM(renewal_value),0)::numeric AS value FROM retention_budget_rows WHERE ${where} GROUP BY 1 ORDER BY value DESC LIMIT 30`, values.slice(0, 7)),
    postgres.query(`SELECT to_char(budget_month,'YYYY-MM') AS key,COUNT(*)::bigint AS accounts,COALESCE(SUM(renewal_value),0)::numeric AS value FROM retention_budget_rows WHERE ${where} GROUP BY budget_month ORDER BY budget_month`, values.slice(0, 7)),
    postgres.query(`SELECT *,COUNT(*) OVER()::bigint AS matching_total FROM retention_budget_rows WHERE ${where} AND (${categorySql(filters.category)}) ORDER BY budget_month,company_name,product LIMIT $8 OFFSET $9`, values),
    postgres.query(
      `SELECT COUNT(*)::bigint AS count FROM crm_records c WHERE c.workspace_id=$1 AND c.object_type='companies' AND c.archived=FALSE
       AND LOWER(COALESCE(c.properties->>'account_type',''))='retention'
       AND NOT EXISTS(SELECT 1 FROM retention_budget_rows b WHERE b.workspace_id=$1 AND b.import_id=$2 AND b.matched_company_id=c.record_id)`,
      [workspaceId, current.id]
    )
  ]);
  const summaryRow = summary.rows[0] ?? {};
  const resultRows = rows.rows.slice(0, filters.limit);
  return {
    configured: true,
    import: serializeImport(current),
    filters,
    summary: {
      accounts: Number(summaryRow.accounts || 0),
      renewalValue: Number(summaryRow.renewal_value || 0),
      bookedValue: Number(summaryRow.booked_value || 0),
      cashCollected: Number(summaryRow.cash_collected || 0),
      remainingCollection: Number(summaryRow.remaining_collection || 0),
      upcoming: Number(summaryRow.upcoming || 0),
      delayed: Number(summaryRow.delayed || 0),
      renewedLate: Number(summaryRow.renewed_late || 0),
      lost: Number(summaryRow.lost || 0),
      unmatched: Number(summaryRow.unmatched || 0),
      notInBudget: Number(notInBudget.rows[0]?.count || 0)
    },
    breakdowns: {
      products: products.rows.map((row) => ({ key: row.key, accounts: Number(row.accounts), value: Number(row.value) })),
      managers: managers.rows.map((row) => ({ key: row.key, accounts: Number(row.accounts), value: Number(row.value) })),
      months: months.rows.map((row) => ({ key: row.key, accounts: Number(row.accounts), value: Number(row.value) }))
    },
    total: Number(rows.rows[0]?.matching_total || 0),
    hasMore: rows.rows.length > filters.limit,
    rows: resultRows.map((row) => ({
      id: row.id,
      companyName: row.company_name,
      companyDomain: row.company_domain,
      product: row.product,
      budgetMonth: row.budget_month,
      renewalValue: Number(row.renewal_value),
      bookedValue: Number(row.booked_value),
      cashCollected: Number(row.cash_collected),
      remainingCollection: Math.max(0, Number(row.renewal_value) - Number(row.cash_collected)),
      rmCsm: row.rm_csm,
      expectedLost: row.expected_lost,
      accountStatus: row.account_status,
      matchStatus: row.match_status,
      matchedCompanyId: row.matched_company_id,
      matchedDealId: row.matched_deal_id,
      duplicateCount: row.duplicate_count
    }))
  };
}

export function registerRetentionBudgetRoutes(app, { postgres, requireViewer, writeAudit }) {
  const base = '/api/v1/customer/workspaces/:workspaceId/retention-budget';

  app.get(`${base}/template.csv`, { preHandler: requireViewer }, async (_request, reply) => reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', 'attachment; filename="retention-budget-template.csv"')
    .header('cache-control', 'private, no-store')
    .send('Company Name,Company Domain,Product,Budget Month,Renewal Value,Booked Value,Cash Collected,RM CSM,Expected Lost,Account Status,Notes\nExample Company,example.com,ATS,2026-08,12000,0,0,Owner Name,false,Active,\n'));

  app.post(`${base}/validate`, { preHandler: requireViewer, bodyLimit: MAX_CSV_BYTES + 1_000_000 }, async (request) => {
    requireManager(request);
    const payload = importPayload(request.body ?? {});
    return {
      headers: payload.headers,
      mapping: payload.mapping,
      currency: payload.validation.currency,
      totalRows: payload.validation.totalRows,
      validRowCount: payload.validation.validRowCount,
      rejectedRowCount: payload.validation.rejectedRowCount,
      duplicateRowCount: payload.validation.duplicateRowCount,
      errors: payload.validation.errors,
      preview: payload.validation.validRows.slice(0, 20)
    };
  });

  app.post(`${base}/imports`, { preHandler: requireViewer, bodyLimit: MAX_CSV_BYTES + 1_000_000 }, async (request, reply) => {
    requireManager(request);
    const payload = importPayload(request.body ?? {});
    if (payload.validation.validRowCount === 0) throw retentionError('No valid retention budget rows were found.');
    const client = await postgres.connect();
    let importRow;
    try {
      await client.query('BEGIN');
      const created = await client.query(
        `INSERT INTO retention_budget_imports(workspace_id,uploaded_by_user_id,file_name,currency,status,column_mapping,row_count,valid_row_count,rejected_row_count,duplicate_row_count,validation_errors)
         VALUES($1,$2,$3,$4,'imported',$5::jsonb,$6,$7,$8,$9,$10::jsonb) RETURNING *`,
        [request.params.workspaceId, request.customer.user.id, payload.fileName, payload.validation.currency,
          JSON.stringify(payload.mapping), payload.validation.totalRows, payload.validation.validRowCount,
          payload.validation.rejectedRowCount, payload.validation.duplicateRowCount, JSON.stringify(payload.validation.errors)]
      );
      importRow = created.rows[0];
      for (const row of payload.validation.validRows) {
        await client.query(
          `INSERT INTO retention_budget_rows(workspace_id,import_id,source_row_number,company_name,company_domain,company_key,product,product_key,budget_month,renewal_value,booked_value,cash_collected,rm_csm,expected_lost,account_status,notes,duplicate_count,raw)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)`,
          [request.params.workspaceId, importRow.id, row.sourceRowNumber, row.companyName, row.companyDomain,
            row.companyKey, row.product, row.productKey, row.budgetMonth, row.renewalValue, row.bookedValue,
            row.cashCollected, row.rmCsm, row.expectedLost, row.accountStatus, row.notes, row.duplicateCount, JSON.stringify(row.raw)]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    await matchImport(postgres, request.params.workspaceId, importRow.id);
    if (payload.activate) {
      const client = await postgres.connect();
      try {
        await client.query('BEGIN');
        await client.query(`UPDATE retention_budget_imports SET active=FALSE,status=CASE WHEN active THEN 'archived' ELSE status END,updated_at=NOW() WHERE workspace_id=$1`, [request.params.workspaceId]);
        await client.query(`UPDATE retention_budget_imports SET active=TRUE,status='active',activated_at=NOW(),updated_at=NOW() WHERE workspace_id=$1 AND id=$2`, [request.params.workspaceId, importRow.id]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally { client.release(); }
    }
    const refreshed = await postgres.query('SELECT * FROM retention_budget_imports WHERE id=$1 AND workspace_id=$2', [importRow.id, request.params.workspaceId]);
    await writeAudit(request, {
      workspaceId: request.params.workspaceId,
      actorUserId: request.customer.user.id,
      action: 'retention_budget.imported',
      targetType: 'retention_budget_import',
      targetId: importRow.id,
      metadata: { rowCount: payload.validation.validRowCount, rejected: payload.validation.rejectedRowCount, duplicates: payload.validation.duplicateRowCount, activated: payload.activate }
    });
    return reply.code(201).send(serializeImport(refreshed.rows[0]));
  });

  app.get(`${base}/imports`, { preHandler: requireViewer }, async (request) => {
    const result = await postgres.query('SELECT * FROM retention_budget_imports WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100', [request.params.workspaceId]);
    return { results: result.rows.map(serializeImport) };
  });

  app.post(`${base}/imports/:importId/activate`, { preHandler: requireViewer }, async (request) => {
    requireManager(request);
    const importId = String(request.params.importId || '');
    if (!UUID_PATTERN.test(importId)) throw retentionError('Import ID is invalid.');
    const client = await postgres.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query('SELECT id FROM retention_budget_imports WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [request.params.workspaceId, importId]);
      if (exists.rowCount === 0) throw retentionError('Retention import not found.', 'RETENTION_IMPORT_NOT_FOUND', 404);
      await client.query(`UPDATE retention_budget_imports SET active=FALSE,status=CASE WHEN active THEN 'archived' ELSE status END,updated_at=NOW() WHERE workspace_id=$1`, [request.params.workspaceId]);
      await client.query(`UPDATE retention_budget_imports SET active=TRUE,status='active',activated_at=NOW(),updated_at=NOW() WHERE workspace_id=$1 AND id=$2`, [request.params.workspaceId, importId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
    await writeAudit(request, { workspaceId: request.params.workspaceId, actorUserId: request.customer.user.id, action: 'retention_budget.activated', targetType: 'retention_budget_import', targetId: importId });
    return buildRetentionBudgetReport(postgres, request.params.workspaceId, {});
  });

  app.delete(`${base}/imports/:importId`, { preHandler: requireViewer }, async (request, reply) => {
    requireManager(request);
    const importId = String(request.params.importId || '');
    if (!UUID_PATTERN.test(importId)) throw retentionError('Import ID is invalid.');
    const result = await postgres.query('DELETE FROM retention_budget_imports WHERE workspace_id=$1 AND id=$2 AND active=FALSE RETURNING id', [request.params.workspaceId, importId]);
    if (result.rowCount === 0) throw retentionError('Only inactive imports can be deleted.', 'RETENTION_IMPORT_NOT_DELETABLE', 409);
    await writeAudit(request, { workspaceId: request.params.workspaceId, actorUserId: request.customer.user.id, action: 'retention_budget.deleted', targetType: 'retention_budget_import', targetId: importId });
    return reply.code(204).send();
  });

  app.get(`${base}/report`, { preHandler: requireViewer }, async (request) => buildRetentionBudgetReport(postgres, request.params.workspaceId, request.query ?? {}));
}
