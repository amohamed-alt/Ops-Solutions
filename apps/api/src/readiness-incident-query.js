const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS_FILTERS = new Set(['all', 'active', 'open', 'acknowledged', 'resolved']);
const SEVERITY_FILTERS = new Set(['all', 'warning', 'critical']);
const SORTS = new Set(['activity_desc', 'activity_asc', 'blockers_desc', 'score_asc', 'occurrences_desc']);
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const MAX_OFFSET = 1_000_000;

const INCIDENT_SELECT = `SELECT i.id,i.workspace_id,w.name AS workspace_name,i.status,i.severity,
       i.first_snapshot_id,i.latest_snapshot_id,i.first_detected_at,i.last_detected_at,
       i.last_notified_at,i.acknowledged_at,i.acknowledged_by,i.resolved_at,i.resolved_by,
       i.note,i.occurrences,i.created_at,i.updated_at,
       s.score,s.blockers,s.warnings,s.generated_at AS snapshot_generated_at
FROM readiness_regression_incidents i
JOIN workspaces w ON w.id=i.workspace_id
JOIN onboarding_readiness_snapshots s ON s.id=i.latest_snapshot_id`;

function requireUuid(value, field) {
  const normalized = String(value ?? '').trim();
  if (!UUID_PATTERN.test(normalized)) throw new TypeError(`${field} must be a valid UUID`);
  return normalized;
}

function boundedInteger(value, fallback, minimum, maximum, field) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TypeError(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function normalizeEnum(value, fallback, allowed, field) {
  const normalized = String(value ?? fallback).trim().toLowerCase();
  if (!allowed.has(normalized)) throw new TypeError(`${field} is invalid`);
  return normalized;
}

function encodeCursor(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (!parsed || parsed.v !== 1 || !Number.isInteger(parsed.offset) || parsed.offset < 0 || parsed.offset > MAX_OFFSET) {
      throw new Error('invalid cursor payload');
    }
    return parsed;
  } catch {
    throw new TypeError('cursor is invalid or expired');
  }
}

function filterFingerprint(options) {
  return [options.status, options.severity, options.minimumBlockers, options.sort].join(':');
}

export function normalizeReadinessIncidentQuery(input = {}) {
  const workspaceId = requireUuid(input.workspaceId, 'workspaceId');
  const status = normalizeEnum(input.status, 'all', STATUS_FILTERS, 'status');
  const severity = normalizeEnum(input.severity, 'all', SEVERITY_FILTERS, 'severity');
  const sort = normalizeEnum(input.sort, 'activity_desc', SORTS, 'sort');
  const minimumBlockers = boundedInteger(input.minimumBlockers, 0, 0, 999, 'minimumBlockers');
  const limit = boundedInteger(input.limit, DEFAULT_LIMIT, 1, MAX_LIMIT, 'limit');
  const cursor = decodeCursor(input.cursor);
  const normalized = { workspaceId, status, severity, sort, minimumBlockers, limit };

  if (cursor && cursor.fingerprint !== filterFingerprint(normalized)) {
    throw new TypeError('cursor does not match the requested filters');
  }

  return { ...normalized, offset: cursor?.offset ?? 0 };
}

function orderClause(sort) {
  if (sort === 'activity_asc') return 'i.updated_at ASC, i.id ASC';
  if (sort === 'blockers_desc') return 's.blockers DESC, i.updated_at DESC, i.id DESC';
  if (sort === 'score_asc') return 's.score ASC, i.updated_at DESC, i.id DESC';
  if (sort === 'occurrences_desc') return 'i.occurrences DESC, i.updated_at DESC, i.id DESC';
  return 'i.updated_at DESC, i.id DESC';
}

function buildWhere(options, values) {
  const where = ['i.workspace_id = $1'];
  if (options.status === 'active') where.push("i.status <> 'resolved'");
  else if (options.status !== 'all') {
    values.push(options.status);
    where.push(`i.status = $${values.length}`);
  }
  if (options.severity !== 'all') {
    values.push(options.severity);
    where.push(`i.severity = $${values.length}`);
  }
  if (options.minimumBlockers > 0) {
    values.push(options.minimumBlockers);
    where.push(`s.blockers >= $${values.length}`);
  }
  return where.join(' AND ');
}

export async function getReadinessRegressionIncident(db, input = {}) {
  const workspaceId = requireUuid(input.workspaceId, 'workspaceId');
  const incidentId = requireUuid(input.incidentId, 'incidentId');
  const result = await db.query(
    `${INCIDENT_SELECT}
     WHERE i.workspace_id=$1 AND i.id=$2
     LIMIT 1`,
    [workspaceId, incidentId]
  );
  return result.rows[0] ?? null;
}

export async function listReadinessRegressionIncidentPage(db, input = {}) {
  const options = normalizeReadinessIncidentQuery(input);
  const values = [options.workspaceId];
  const where = buildWhere(options, values);

  const countResult = await db.query(
    `SELECT COUNT(*)::INTEGER AS total
     FROM readiness_regression_incidents i
     JOIN onboarding_readiness_snapshots s ON s.id=i.latest_snapshot_id
     WHERE ${where}`,
    values
  );

  const queryValues = [...values, options.limit + 1, options.offset];
  const limitParameter = `$${queryValues.length - 1}`;
  const offsetParameter = `$${queryValues.length}`;
  const result = await db.query(
    `${INCIDENT_SELECT}
     WHERE ${where}
     ORDER BY ${orderClause(options.sort)}
     LIMIT ${limitParameter} OFFSET ${offsetParameter}`,
    queryValues
  );

  const hasNextPage = result.rows.length > options.limit;
  const rows = hasNextPage ? result.rows.slice(0, options.limit) : result.rows;
  const nextOffset = options.offset + rows.length;
  const nextCursor = hasNextPage
    ? encodeCursor({ v: 1, offset: nextOffset, fingerprint: filterFingerprint(options) })
    : null;

  return {
    rows,
    total: Number(countResult.rows[0]?.total ?? 0),
    pageInfo: {
      limit: options.limit,
      offset: options.offset,
      hasNextPage,
      nextCursor
    },
    filters: {
      status: options.status,
      severity: options.severity,
      minimumBlockers: options.minimumBlockers,
      sort: options.sort
    }
  };
}
