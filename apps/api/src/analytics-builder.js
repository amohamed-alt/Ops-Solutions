const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAME_MAX = 100;
const TEXT_MAX = 240;
const JSON_MAX_BYTES = 80_000;

const OBJECT_TYPES = new Set(['contacts', 'companies', 'deals', 'activities']);
const METRICS = new Set(['count', 'sum_amount', 'average_amount', 'conversion_rate']);
const AGGREGATIONS = new Set(['count', 'sum', 'average', 'rate']);
const GROUP_BY = new Set([
  'none',
  'owner',
  'country',
  'lead_status',
  'lifecycle_stage',
  'industry',
  'source',
  'pipeline',
  'stage',
  'created_month'
]);
const CHART_TYPES = new Set(['kpi', 'table', 'bar', 'line', 'pie']);
const FILTER_KEYS = Object.freeze(['from', 'to', 'ownerId', 'country', 'pipelineId', 'stageId', 'leadSource']);

const REPORT_TEMPLATES = Object.freeze([
  { key: 'contacts-by-lead-status', name: 'Contacts by Lead Status', objectType: 'contacts', metric: 'count', groupBy: 'lead_status', chartType: 'bar' },
  { key: 'contacts-by-lifecycle-stage', name: 'Contacts by Lifecycle Stage', objectType: 'contacts', metric: 'count', groupBy: 'lifecycle_stage', chartType: 'bar' },
  { key: 'contacts-by-country', name: 'Contacts by Country', objectType: 'contacts', metric: 'count', groupBy: 'country', chartType: 'pie' },
  { key: 'companies-by-industry', name: 'Companies by Industry', objectType: 'companies', metric: 'count', groupBy: 'industry', chartType: 'bar' },
  { key: 'deals-by-stage', name: 'Deals by Stage', objectType: 'deals', metric: 'sum_amount', groupBy: 'stage', chartType: 'bar' },
  { key: 'source-to-pipeline', name: 'Source to Pipeline', objectType: 'deals', metric: 'sum_amount', groupBy: 'source', chartType: 'bar' }
]);

const DASHBOARD_TEMPLATES = Object.freeze([
  { key: 'executive-revenue', name: 'Executive Revenue Dashboard', reports: ['deals-by-stage', 'source-to-pipeline', 'contacts-by-lifecycle-stage'] },
  { key: 'sdr-execution', name: 'SDR Execution Dashboard', reports: ['contacts-by-lead-status', 'contacts-by-country'] },
  { key: 'crm-quality', name: 'CRM Quality Dashboard', reports: ['contacts-by-lifecycle-stage', 'companies-by-industry'] }
]);

function builderError(message, category = 'INVALID_BUILDER_INPUT', statusCode = 400) {
  const error = new Error(message);
  error.category = category;
  error.statusCode = statusCode;
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeUuid(value, label = 'ID') {
  const id = String(value ?? '').trim();
  if (!UUID_PATTERN.test(id)) throw builderError(`${label} is invalid.`);
  return id;
}

function normalizeName(value, label = 'Name') {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > NAME_MAX) throw builderError(`${label} must be between 2 and ${NAME_MAX} characters.`);
  return name;
}

function normalizeEnum(value, allowed, label, fallback) {
  const normalized = String(value ?? fallback ?? '').trim().toLowerCase();
  if (!allowed.has(normalized)) throw builderError(`Choose a supported ${label}.`);
  return normalized;
}

function normalizeFilters(value = {}) {
  if (!isPlainObject(value)) throw builderError('Report filters must be an object.');
  return Object.fromEntries(FILTER_KEYS.map((key) => {
    const normalized = String(value[key] ?? '').trim();
    if (normalized.length > TEXT_MAX) throw builderError(`${key} is too long.`);
    return [key, normalized];
  }));
}

function normalizeJson(value, label, fallback = {}) {
  if (value === undefined || value === null) return fallback;
  if (!isPlainObject(value) && !Array.isArray(value)) throw builderError(`${label} must be an object or array.`);
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > JSON_MAX_BYTES) throw builderError(`${label} is too large.`);
  return JSON.parse(serialized);
}

export function normalizeBuilderReport(input = {}, { partial = false } = {}) {
  if (!isPlainObject(input)) throw builderError('Report builder input must be an object.');
  const output = {};
  if (!partial || Object.hasOwn(input, 'name')) output.name = normalizeName(input.name, 'Report name');
  if (!partial || Object.hasOwn(input, 'objectType')) output.objectType = normalizeEnum(input.objectType, OBJECT_TYPES, 'object type', 'contacts');
  if (!partial || Object.hasOwn(input, 'metric')) output.metric = normalizeEnum(input.metric, METRICS, 'metric', 'count');
  if (!partial || Object.hasOwn(input, 'aggregation')) output.aggregation = normalizeEnum(input.aggregation, AGGREGATIONS, 'aggregation', output.metric === 'count' ? 'count' : 'sum');
  if (!partial || Object.hasOwn(input, 'groupBy')) output.groupBy = normalizeEnum(input.groupBy, GROUP_BY, 'group by', 'none');
  if (!partial || Object.hasOwn(input, 'chartType')) output.chartType = normalizeEnum(input.chartType, CHART_TYPES, 'chart type', 'bar');
  if (!partial || Object.hasOwn(input, 'filters')) output.filters = normalizeFilters(input.filters);
  if (!partial || Object.hasOwn(input, 'visualization')) output.visualization = normalizeJson(input.visualization, 'Visualization', {});
  if (partial && Object.keys(output).length === 0) throw builderError('Provide at least one report field to update.');
  return output;
}

export function normalizeBuilderDashboard(input = {}, { partial = false } = {}) {
  if (!isPlainObject(input)) throw builderError('Dashboard builder input must be an object.');
  const output = {};
  if (!partial || Object.hasOwn(input, 'name')) output.name = normalizeName(input.name, 'Dashboard name');
  if (!partial || Object.hasOwn(input, 'description')) output.description = String(input.description ?? '').trim().replace(/\s+/g, ' ').slice(0, 500);
  if (!partial || Object.hasOwn(input, 'layout')) {
    const layout = normalizeJson(input.layout, 'Dashboard layout', []);
    if (!Array.isArray(layout)) throw builderError('Dashboard layout must be an array.');
    output.layout = layout.slice(0, 60).map((widget, index) => {
      if (!isPlainObject(widget)) throw builderError('Every dashboard widget must be an object.');
      return {
        id: String(widget.id ?? `widget-${index + 1}`).slice(0, 80),
        reportId: String(widget.reportId ?? '').trim(),
        title: String(widget.title ?? '').trim().slice(0, 140),
        width: ['half', 'full', 'third'].includes(widget.width) ? widget.width : 'half'
      };
    });
  }
  if (partial && Object.keys(output).length === 0) throw builderError('Provide at least one dashboard field to update.');
  return output;
}

export async function ensureAnalyticsBuilderSchema(postgres) {
  await postgres.query(`
    CREATE TABLE IF NOT EXISTS analytics_builder_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_by_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      object_type TEXT NOT NULL,
      metric TEXT NOT NULL,
      aggregation TEXT NOT NULL,
      group_by TEXT NOT NULL,
      chart_type TEXT NOT NULL,
      filters JSONB NOT NULL DEFAULT '{}'::jsonb,
      visualization JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, created_by_user_id, name)
    );

    CREATE TABLE IF NOT EXISTS analytics_builder_dashboards (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_by_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      layout JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, created_by_user_id, name)
    );

    CREATE INDEX IF NOT EXISTS analytics_builder_reports_workspace_idx
      ON analytics_builder_reports(workspace_id, created_by_user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS analytics_builder_dashboards_workspace_idx
      ON analytics_builder_dashboards(workspace_id, created_by_user_id, updated_at DESC);
  `);
}

function serializeReport(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    objectType: row.object_type,
    metric: row.metric,
    aggregation: row.aggregation,
    groupBy: row.group_by,
    chartType: row.chart_type,
    filters: row.filters ?? {},
    visualization: row.visualization ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeDashboard(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description ?? '',
    layout: row.layout ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function sendDatabaseConflict(error, reply) {
  if (error?.code === '23505') {
    return reply.code(409).send({ error: 'builder_name_exists', message: 'A builder item with this name already exists.' });
  }
  throw error;
}

export function registerAnalyticsBuilderRoutes(app, { postgres, requireViewer, writeAudit }) {
  const base = '/api/v1/customer/workspaces/:workspaceId/analytics-builder';

  app.get(`${base}/catalog`, { preHandler: requireViewer }, async () => ({
    objectTypes: [...OBJECT_TYPES],
    metrics: [...METRICS],
    aggregations: [...AGGREGATIONS],
    groupBy: [...GROUP_BY],
    chartTypes: [...CHART_TYPES],
    reportTemplates: REPORT_TEMPLATES,
    dashboardTemplates: DASHBOARD_TEMPLATES
  }));

  app.get(`${base}/reports`, { preHandler: requireViewer }, async (request) => {
    const result = await postgres.query(
      `SELECT * FROM analytics_builder_reports
       WHERE workspace_id = $1 AND created_by_user_id = $2
       ORDER BY updated_at DESC, lower(name) LIMIT 200`,
      [request.params.workspaceId, request.customer.user.id]
    );
    return { results: result.rows.map(serializeReport) };
  });

  app.post(`${base}/reports`, { preHandler: requireViewer }, async (request, reply) => {
    const report = normalizeBuilderReport(request.body ?? {});
    try {
      const result = await postgres.query(
        `INSERT INTO analytics_builder_reports(workspace_id, created_by_user_id, name, object_type, metric, aggregation, group_by, chart_type, filters, visualization)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb) RETURNING *`,
        [request.params.workspaceId, request.customer.user.id, report.name, report.objectType, report.metric, report.aggregation,
          report.groupBy, report.chartType, JSON.stringify(report.filters), JSON.stringify(report.visualization)]
      );
      const created = serializeReport(result.rows[0]);
      await writeAudit(request, { workspaceId: request.params.workspaceId, actorUserId: request.customer.user.id,
        action: 'analytics_builder.report_created', targetType: 'analytics_builder_report', targetId: created.id,
        metadata: { name: created.name, objectType: created.objectType, metric: created.metric } });
      return reply.code(201).send(created);
    } catch (error) {
      return sendDatabaseConflict(error, reply);
    }
  });

  app.patch(`${base}/reports/:reportId`, { preHandler: requireViewer }, async (request, reply) => {
    const reportId = normalizeUuid(request.params.reportId, 'Report ID');
    const report = normalizeBuilderReport(request.body ?? {}, { partial: true });
    const values = [reportId, request.params.workspaceId, request.customer.user.id];
    const assignments = [];
    const columns = {
      name: ['name', (value) => value, ''],
      objectType: ['object_type', (value) => value, ''],
      metric: ['metric', (value) => value, ''],
      aggregation: ['aggregation', (value) => value, ''],
      groupBy: ['group_by', (value) => value, ''],
      chartType: ['chart_type', (value) => value, ''],
      filters: ['filters', (value) => JSON.stringify(value), '::jsonb'],
      visualization: ['visualization', (value) => JSON.stringify(value), '::jsonb']
    };
    for (const [key, value] of Object.entries(report)) {
      const [column, serializeValue, cast] = columns[key];
      values.push(serializeValue(value));
      assignments.push(`${column} = $${values.length}${cast}`);
    }
    try {
      const result = await postgres.query(
        `UPDATE analytics_builder_reports SET ${assignments.join(', ')}, updated_at = NOW()
         WHERE id = $1 AND workspace_id = $2 AND created_by_user_id = $3 RETURNING *`,
        values
      );
      if (result.rowCount === 0) throw builderError('Report builder item not found.', 'REPORT_BUILDER_NOT_FOUND', 404);
      const updated = serializeReport(result.rows[0]);
      await writeAudit(request, { workspaceId: request.params.workspaceId, actorUserId: request.customer.user.id,
        action: 'analytics_builder.report_updated', targetType: 'analytics_builder_report', targetId: reportId });
      return updated;
    } catch (error) {
      return sendDatabaseConflict(error, reply);
    }
  });

  app.delete(`${base}/reports/:reportId`, { preHandler: requireViewer }, async (request, reply) => {
    const reportId = normalizeUuid(request.params.reportId, 'Report ID');
    const result = await postgres.query(
      'DELETE FROM analytics_builder_reports WHERE id = $1 AND workspace_id = $2 AND created_by_user_id = $3 RETURNING id, name',
      [reportId, request.params.workspaceId, request.customer.user.id]
    );
    if (result.rowCount === 0) throw builderError('Report builder item not found.', 'REPORT_BUILDER_NOT_FOUND', 404);
    await writeAudit(request, { workspaceId: request.params.workspaceId, actorUserId: request.customer.user.id,
      action: 'analytics_builder.report_deleted', targetType: 'analytics_builder_report', targetId: reportId,
      metadata: { name: result.rows[0].name } });
    return reply.code(204).send();
  });

  app.get(`${base}/dashboards`, { preHandler: requireViewer }, async (request) => {
    const result = await postgres.query(
      `SELECT * FROM analytics_builder_dashboards
       WHERE workspace_id = $1 AND created_by_user_id = $2
       ORDER BY updated_at DESC, lower(name) LIMIT 100`,
      [request.params.workspaceId, request.customer.user.id]
    );
    return { results: result.rows.map(serializeDashboard) };
  });

  app.post(`${base}/dashboards`, { preHandler: requireViewer }, async (request, reply) => {
    const dashboard = normalizeBuilderDashboard(request.body ?? {});
    try {
      const result = await postgres.query(
        `INSERT INTO analytics_builder_dashboards(workspace_id, created_by_user_id, name, description, layout)
         VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *`,
        [request.params.workspaceId, request.customer.user.id, dashboard.name, dashboard.description, JSON.stringify(dashboard.layout)]
      );
      const created = serializeDashboard(result.rows[0]);
      await writeAudit(request, { workspaceId: request.params.workspaceId, actorUserId: request.customer.user.id,
        action: 'analytics_builder.dashboard_created', targetType: 'analytics_builder_dashboard', targetId: created.id,
        metadata: { name: created.name, widgetCount: created.layout.length } });
      return reply.code(201).send(created);
    } catch (error) {
      return sendDatabaseConflict(error, reply);
    }
  });

  app.patch(`${base}/dashboards/:dashboardId`, { preHandler: requireViewer }, async (request, reply) => {
    const dashboardId = normalizeUuid(request.params.dashboardId, 'Dashboard ID');
    const dashboard = normalizeBuilderDashboard(request.body ?? {}, { partial: true });
    const values = [dashboardId, request.params.workspaceId, request.customer.user.id];
    const assignments = [];
    const columns = {
      name: ['name', (value) => value, ''],
      description: ['description', (value) => value, ''],
      layout: ['layout', (value) => JSON.stringify(value), '::jsonb']
    };
    for (const [key, value] of Object.entries(dashboard)) {
      const [column, serializeValue, cast] = columns[key];
      values.push(serializeValue(value));
      assignments.push(`${column} = $${values.length}${cast}`);
    }
    try {
      const result = await postgres.query(
        `UPDATE analytics_builder_dashboards SET ${assignments.join(', ')}, updated_at = NOW()
         WHERE id = $1 AND workspace_id = $2 AND created_by_user_id = $3 RETURNING *`,
        values
      );
      if (result.rowCount === 0) throw builderError('Dashboard builder item not found.', 'DASHBOARD_BUILDER_NOT_FOUND', 404);
      const updated = serializeDashboard(result.rows[0]);
      await writeAudit(request, { workspaceId: request.params.workspaceId, actorUserId: request.customer.user.id,
        action: 'analytics_builder.dashboard_updated', targetType: 'analytics_builder_dashboard', targetId: dashboardId });
      return updated;
    } catch (error) {
      return sendDatabaseConflict(error, reply);
    }
  });

  app.delete(`${base}/dashboards/:dashboardId`, { preHandler: requireViewer }, async (request, reply) => {
    const dashboardId = normalizeUuid(request.params.dashboardId, 'Dashboard ID');
    const result = await postgres.query(
      'DELETE FROM analytics_builder_dashboards WHERE id = $1 AND workspace_id = $2 AND created_by_user_id = $3 RETURNING id, name',
      [dashboardId, request.params.workspaceId, request.customer.user.id]
    );
    if (result.rowCount === 0) throw builderError('Dashboard builder item not found.', 'DASHBOARD_BUILDER_NOT_FOUND', 404);
    await writeAudit(request, { workspaceId: request.params.workspaceId, actorUserId: request.customer.user.id,
      action: 'analytics_builder.dashboard_deleted', targetType: 'analytics_builder_dashboard', targetId: dashboardId,
      metadata: { name: result.rows[0].name } });
    return reply.code(204).send();
  });
}
