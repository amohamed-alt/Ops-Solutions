import { buildWorkspaceSlug, normalizeCompanyName, workspaceLimit } from './customer-workspaces.js';
import { buildRevenueReportingPack, normalizeReportingFilters } from './revenue-reporting.js';

const DATE_PRESETS = new Set([
  'today', 'yesterday', 'last_7_days', 'last_30_days', 'this_month',
  'previous_month', 'this_quarter', 'this_year', 'custom'
]);
const MAX_CSV_BYTES = 5 * 1024 * 1024;
const CUSTOMER_EXPORTS_PER_MINUTE = 5;

function validationError(message, category = 'INVALID_EXPORT_REQUEST') {
  const error = new Error(message);
  error.statusCode = 400;
  error.category = category;
  return error;
}

function dateString(date) {
  return date.toISOString().slice(0, 10);
}

function startOfDay(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function resolveDatePreset(preset, storedFilters = {}, now = new Date()) {
  const normalized = String(preset ?? 'last_30_days').trim().toLowerCase();
  if (!DATE_PRESETS.has(normalized)) throw validationError('Unsupported saved-view date preset.');
  if (normalized === 'custom') {
    return normalizeReportingFilters({ ...storedFilters, from: storedFilters.from, to: storedFilters.to }, now);
  }

  const end = startOfDay(now);
  let from = new Date(end);
  let to = new Date(end);
  switch (normalized) {
    case 'today':
      break;
    case 'yesterday':
      from.setUTCDate(from.getUTCDate() - 1);
      to = new Date(from);
      break;
    case 'last_7_days':
      from.setUTCDate(from.getUTCDate() - 6);
      break;
    case 'this_month':
      from = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
      break;
    case 'previous_month':
      from = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1));
      to = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0));
      break;
    case 'this_quarter':
      from = new Date(Date.UTC(end.getUTCFullYear(), Math.floor(end.getUTCMonth() / 3) * 3, 1));
      break;
    case 'this_year':
      from = new Date(Date.UTC(end.getUTCFullYear(), 0, 1));
      break;
    case 'last_30_days':
    default:
      from.setUTCDate(from.getUTCDate() - 29);
      break;
  }
  return normalizeReportingFilters({ ...storedFilters, from: dateString(from), to: dateString(to) }, now);
}

function safeCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  let text = String(value).replace(/\r\n?/g, '\n');
  if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
  return text;
}

export function csvRow(values) {
  return values.map((value) => {
    const text = safeCell(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(',');
}

function section(lines, title, headers, rows) {
  lines.push(csvRow([title]));
  lines.push(csvRow(headers));
  for (const row of rows) lines.push(csvRow(row));
  lines.push('');
}

function humanize(value) {
  return String(value ?? '').replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function buildRevenueCsv({ workspace, report, viewName = null, dataFreshnessAt = null }) {
  const freshness = dataFreshnessAt instanceof Date ? dataFreshnessAt.toISOString() : dataFreshnessAt;
  const lines = ['\uFEFF' + csvRow(['Ops Solutions Revenue Intelligence Export'])];
  lines.push(csvRow(['Workspace', workspace.name]));
  lines.push(csvRow(['Generated at', report.generatedAt]));
  lines.push(csvRow(['Data freshness', freshness || 'No synchronized records']));
  lines.push(csvRow(['Reporting period', `${report.filters.from} to ${report.filters.to}`]));
  lines.push(csvRow(['Saved view', viewName || 'Ad hoc filters']));
  lines.push(csvRow(['Owner filter', report.filters.ownerId ?? 'All owners']));
  lines.push(csvRow(['Country filter', report.filters.country ?? 'All countries']));
  lines.push(csvRow(['Lead source filter', report.filters.leadSource ?? 'All sources']));
  lines.push(csvRow(['Pipeline filter', report.filters.pipelineId ?? 'All pipelines']));
  lines.push(csvRow(['Stage filter', report.filters.stageId ?? 'All stages']));
  lines.push('');

  section(lines, 'Executive overview', ['Metric', 'Value'], Object.entries(report.overview).map(([key, value]) => [humanize(key), value]));
  section(lines, 'Period comparisons', ['Metric', 'Current', 'Previous', 'Delta percent'], Object.entries(report.comparisons).map(([key, value]) => [humanize(key), value.current, value.previous, value.deltaPercent]));
  section(lines, 'Activity trend', ['Date', 'Calls', 'Meetings', 'Tasks'], report.activityTrend.map((row) => [row.day, row.calls, row.meetings, row.tasks]));
  section(lines, 'Pipeline by stage', ['Pipeline', 'Stage', 'Deals', 'Amount'], report.pipelineByStage.map((row) => [row.pipelineLabel, row.stageLabel, row.deals, row.amount]));
  section(lines, 'Lead source performance', ['Lead source', 'Contacts', 'Contacted', 'Opportunities', 'Won', 'Win rate'], report.leadSourcePerformance.map((row) => [row.key, row.contacts, row.contacted, row.opportunities, row.won, row.winRate]));
  section(lines, 'Market distribution', ['Country or market', 'Contacts'], report.countryDistribution.map((row) => [row.key, row.value]));
  section(lines, 'Owner performance', ['Owner', 'Email', 'Calls', 'Meetings', 'Tasks', 'Meeting rate', 'Open deals', 'Open pipeline', 'Won revenue'], report.ownerPerformance.map((row) => [row.ownerName, row.email, row.calls, row.meetings, row.tasks, row.meetingRate, row.openDeals, row.openPipeline, row.wonRevenue]));
  section(lines, 'Call outcomes', ['Outcome', 'Count'], report.outcomes.calls.map((row) => [humanize(row.key), row.value]));
  section(lines, 'Meeting outcomes', ['Outcome', 'Count'], report.outcomes.meetings.map((row) => [humanize(row.key), row.value]));
  section(lines, 'Task outcomes', ['Status', 'Count'], report.outcomes.tasks.map((row) => [humanize(row.key), row.value]));
  section(lines, 'Action queue', ['Signal', 'Count'], Object.entries(report.attention).map(([key, value]) => [humanize(key), value]));
  section(lines, 'CRM data quality', ['Field', 'Complete', 'Missing', 'Completeness percent'], report.dataQuality.fields.map((row) => [humanize(row.key), row.complete, row.missing, row.percentage]));
  lines.push(csvRow(['Overall CRM quality score', report.dataQuality.score]));
  return lines.join('\r\n');
}

async function dataFreshness(postgres, workspaceId) {
  const result = await postgres.query(
    'SELECT MAX(synced_at) AS data_freshness_at FROM crm_records WHERE workspace_id = $1',
    [workspaceId]
  );
  return result.rows[0]?.data_freshness_at ?? null;
}

export async function buildRevenueCsvExport(postgres, workspace, query) {
  const filters = normalizeReportingFilters(query ?? {});
  const [report, dataFreshnessAt] = await Promise.all([
    buildRevenueReportingPack(postgres, workspace.id, filters),
    dataFreshness(postgres, workspace.id)
  ]);
  const viewName = cleanViewName(query?.viewName);
  const csv = buildRevenueCsv({ workspace, report, viewName, dataFreshnessAt });
  if (Buffer.byteLength(csv, 'utf8') > MAX_CSV_BYTES) {
    const error = new Error('This export is too large. Narrow the reporting filters and try again.');
    error.statusCode = 413;
    error.category = 'EXPORT_TOO_LARGE';
    throw error;
  }
  return {
    csv,
    report,
    viewName,
    fileName: `${filenamePart(workspace.name)}-revenue-report-${report.filters.from}-to-${report.filters.to}.csv`
  };
}

function sendCsv(reply, result) {
  return reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${result.fileName}"`)
    .header('cache-control', 'private, no-store, max-age=0')
    .header('x-content-type-options', 'nosniff')
    .send(result.csv);
}

export async function enforceCustomerRateLimit(redis, workspaceId, userId, now = Date.now()) {
  const bucket = Math.floor(now / 60_000);
  const key = `rate:revenue-export:${workspaceId}:${userId}:${bucket}`;
  const results = await redis.multi().incr(key).expire(key, 120).exec();
  const count = Number(results?.[0]?.[1] ?? 0);
  if (count > CUSTOMER_EXPORTS_PER_MINUTE) {
    const error = new Error('Too many exports were requested. Try again in a minute.');
    error.statusCode = 429;
    error.category = 'EXPORT_RATE_LIMITED';
    throw error;
  }
  return { limit: CUSTOMER_EXPORTS_PER_MINUTE, remaining: Math.max(0, CUSTOMER_EXPORTS_PER_MINUTE - count) };
}

function filenamePart(value) {
  return String(value ?? 'workspace').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'workspace';
}

function cleanViewName(value) {
  const result = String(value ?? '').trim().replace(/\s+/g, ' ');
  return result ? result.slice(0, 100) : null;
}

export function registerReportExportRoutes(app, { postgres, requireAdmin, requireWorkspace }) {
  app.get('/api/v1/workspaces/:workspaceId/analytics/revenue/export.csv', { preHandler: requireAdmin }, async (request, reply) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    return sendCsv(reply, await buildRevenueCsvExport(postgres, workspace, request.query));
  });
}

export function registerCustomerReportExportRoutes(app, {
  postgres,
  redis,
  requireViewer,
  requireWorkspace,
  writeAudit
}) {
  app.post(
    '/api/v1/customer/workspaces/:workspaceId/companies',
    { preHandler: requireViewer },
    async (request, reply) => {
      const name = normalizeCompanyName(request.body?.name ?? request.body?.companyName);
      if (name.length < 2) {
        return reply.code(400).send({
          error: 'invalid_workspace',
          message: 'Company name must be between 2 and 120 characters.'
        });
      }

      const limit = workspaceLimit();
      const countResult = await postgres.query(
        'SELECT COUNT(*)::int AS count FROM workspace_memberships WHERE user_id = $1',
        [request.customer.user.id]
      );
      if (Number(countResult.rows[0]?.count ?? 0) >= limit) {
        return reply.code(409).send({
          error: 'workspace_limit_reached',
          message: `Your account can create up to ${limit} company workspaces.`
        });
      }

      let result = null;
      for (let attempt = 0; attempt < 5 && !result; attempt += 1) {
        try {
          result = await postgres.query(
            `WITH created_workspace AS (
               INSERT INTO workspaces(name, slug)
               VALUES ($1, $2)
               RETURNING id, name, slug, status, created_at, updated_at
             ), created_membership AS (
               INSERT INTO workspace_memberships(user_id, workspace_id, role)
               SELECT $3, id, 'owner' FROM created_workspace
               RETURNING workspace_id, role
             )
             SELECT w.id, w.name, w.slug, w.status, w.created_at, w.updated_at, m.role
             FROM created_workspace w
             JOIN created_membership m ON m.workspace_id = w.id`,
            [name, buildWorkspaceSlug(name), request.customer.user.id]
          );
        } catch (error) {
          if (error.code !== '23505' || attempt === 4) throw error;
        }
      }

      const created = result.rows[0];
      await writeAudit(request, {
        workspaceId: created.id,
        actorUserId: request.customer.user.id,
        action: 'workspace.created',
        targetType: 'workspace',
        targetId: created.id,
        metadata: { companyName: created.name, source: 'customer_self_service' }
      });

      return reply.code(201).send({
        workspace: {
          id: created.id,
          name: created.name,
          slug: created.slug,
          status: created.status,
          role: created.role,
          portalId: null,
          hubspotStatus: null,
          lastDiscoveredAt: null
        },
        nextPath: `/onboarding?workspace=${created.id}`
      });
    }
  );

  app.get(
    '/api/v1/customer/workspaces/:workspaceId/exports/revenue.csv',
    { preHandler: requireViewer },
    async (request, reply) => {
      const workspace = await requireWorkspace(request.params.workspaceId);
      const rateLimit = await enforceCustomerRateLimit(
        redis,
        workspace.id,
        request.customer.user.id
      );
      const result = await buildRevenueCsvExport(postgres, workspace, request.query);
      await writeAudit(request, {
        workspaceId: workspace.id,
        actorUserId: request.customer.user.id,
        action: 'report.exported',
        targetType: 'revenue_report',
        metadata: {
          format: 'csv',
          from: result.report.filters.from,
          to: result.report.filters.to,
          viewName: result.viewName
        }
      });
      reply
        .header('x-rate-limit-limit', String(rateLimit.limit))
        .header('x-rate-limit-remaining', String(rateLimit.remaining));
      return sendCsv(reply, result);
    }
  );
}
