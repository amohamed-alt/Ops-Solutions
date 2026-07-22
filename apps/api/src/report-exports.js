import { buildRevenueReportingPack, normalizeReportingFilters } from './revenue-reporting.js';

const DATE_PRESETS = new Set([
  'today', 'yesterday', 'last_7_days', 'last_30_days', 'this_month',
  'previous_month', 'this_quarter', 'this_year', 'custom'
]);

function validationError(message, category = 'INVALID_EXPORT_REQUEST') {
  const error = new Error(message);
  error.statusCode = 400;
  error.category = category;
  return error;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ''));
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
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
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

export function buildRevenueCsv({ workspace, report, sourceView = null }) {
  const lines = ['\uFEFF' + csvRow(['Ops Solutions Revenue Intelligence Export'])];
  lines.push(csvRow(['Workspace', workspace.name]));
  lines.push(csvRow(['Generated at', report.generatedAt]));
  lines.push(csvRow(['Reporting period', `${report.filters.from} to ${report.filters.to}`]));
  lines.push(csvRow(['Saved view', sourceView?.name ?? 'Ad hoc filters']));
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

function filenamePart(value) {
  return String(value ?? 'workspace').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'workspace';
}

async function loadSavedView(postgres, workspaceId, userId, viewId) {
  if (!isUuid(viewId)) throw validationError('Saved view ID is invalid.');
  const result = await postgres.query(
    `SELECT id, name, date_preset, filters
     FROM saved_reporting_views
     WHERE id = $1 AND workspace_id = $2 AND user_id = $3`,
    [viewId, workspaceId, userId]
  );
  if (result.rowCount === 0) {
    const error = new Error('Saved reporting view not found.');
    error.statusCode = 404;
    error.category = 'SAVED_VIEW_NOT_FOUND';
    throw error;
  }
  return result.rows[0];
}

export function registerReportExportRoutes(app, { postgres, requireViewer, writeAudit }) {
  app.get('/api/v1/customer/workspaces/:workspaceId/exports/revenue.csv', { preHandler: requireViewer }, async (request, reply) => {
    const workspaceId = request.params.workspaceId;
    const userId = request.customer.user.id;
    const sourceView = request.query?.viewId ? await loadSavedView(postgres, workspaceId, userId, request.query.viewId) : null;
    const filters = sourceView
      ? resolveDatePreset(sourceView.date_preset, sourceView.filters ?? {})
      : normalizeReportingFilters(request.query ?? {});
    const report = await buildRevenueReportingPack(postgres, workspaceId, filters);
    const workspaceResult = await postgres.query('SELECT id, name FROM workspaces WHERE id = $1', [workspaceId]);
    const workspace = workspaceResult.rows[0] ?? { id: workspaceId, name: 'Workspace' };
    const csv = buildRevenueCsv({ workspace, report, sourceView });
    const fileName = `${filenamePart(workspace.name)}-revenue-report-${report.filters.from}-to-${report.filters.to}.csv`;

    await writeAudit(request, {
      workspaceId,
      actorUserId: userId,
      action: 'reporting_export.downloaded',
      targetType: 'revenue_report',
      targetId: sourceView?.id ?? null,
      metadata: {
        format: 'csv',
        savedViewId: sourceView?.id ?? null,
        from: report.filters.from,
        to: report.filters.to,
        filterCount: ['ownerId', 'country', 'leadSource', 'pipelineId', 'stageId'].filter((key) => Boolean(report.filters[key])).length
      }
    });

    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${fileName}"`)
      .header('cache-control', 'private, no-store, max-age=0')
      .send(csv);
  });
}
