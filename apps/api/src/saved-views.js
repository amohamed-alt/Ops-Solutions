import { registerWorkspacePreferencesRoutes } from './workspace-preferences.js';

const DATE_PRESETS = new Set([
  'today',
  'yesterday',
  'last_7_days',
  'last_30_days',
  'this_month',
  'previous_month',
  'this_quarter',
  'this_year',
  'custom'
]);

const SECTIONS = new Set(['overview', 'activity', 'pipeline', 'sources', 'team', 'quality']);
const FILTER_KEYS = Object.freeze(['from', 'to', 'ownerId', 'country', 'pipelineId', 'stageId', 'leadSource']);
const VIEW_NAME_MAX_LENGTH = 100;
const FILTER_VALUE_MAX_LENGTH = 240;
const WIDGET_CONFIGURATION_MAX_BYTES = 50_000;

function validationError(message, category = 'INVALID_SAVED_VIEW') {
  const error = new Error(message);
  error.statusCode = 400;
  error.category = category;
  return error;
}

function notFoundError() {
  const error = new Error('Saved reporting view not found.');
  error.statusCode = 404;
  error.category = 'SAVED_VIEW_NOT_FOUND';
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeViewId(value) {
  const id = String(value ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw validationError('Saved view ID is invalid.');
  }
  return id;
}

function normalizeDateString(value, label) {
  const normalized = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw validationError(`${label} must use YYYY-MM-DD format.`, 'INVALID_SAVED_VIEW_DATES');
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw validationError(`${label} is not a valid calendar date.`, 'INVALID_SAVED_VIEW_DATES');
  }
  return normalized;
}

export function normalizeSavedViewName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > VIEW_NAME_MAX_LENGTH) {
    throw validationError(`Saved view name must be between 2 and ${VIEW_NAME_MAX_LENGTH} characters.`);
  }
  return name;
}

function normalizeDatePreset(value) {
  const preset = String(value ?? 'last_30_days').trim().toLowerCase();
  if (!DATE_PRESETS.has(preset)) throw validationError('Choose a supported relative date preset.');
  return preset;
}

export function normalizeSavedViewFilters(value = {}, datePreset = 'last_30_days') {
  if (!isPlainObject(value)) throw validationError('Saved view filters must be an object.');
  const filters = Object.fromEntries(FILTER_KEYS.map((key) => {
    const normalized = String(value[key] ?? '').trim();
    if (normalized.length > FILTER_VALUE_MAX_LENGTH) {
      throw validationError(`${key} exceeds the maximum supported length.`);
    }
    return [key, normalized];
  }));

  if (datePreset !== 'custom') {
    filters.from = '';
    filters.to = '';
    return filters;
  }

  filters.from = normalizeDateString(filters.from, 'Custom start date');
  filters.to = normalizeDateString(filters.to, 'Custom end date');
  const fromTime = new Date(`${filters.from}T00:00:00.000Z`).getTime();
  const toTime = new Date(`${filters.to}T00:00:00.000Z`).getTime();
  if (fromTime > toTime) {
    throw validationError('Custom start date must be on or before the end date.', 'INVALID_SAVED_VIEW_DATES');
  }
  if (Math.floor((toTime - fromTime) / 86_400_000) + 1 > 366) {
    throw validationError('Custom reporting ranges cannot exceed 366 days.', 'INVALID_SAVED_VIEW_DATES');
  }
  return filters;
}

function normalizeSection(value) {
  const section = String(value ?? '').trim().toLowerCase();
  if (!SECTIONS.has(section)) throw validationError('Choose a supported dashboard section.');
  return section;
}

function normalizeWidgetConfiguration(value) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) throw validationError('Widget configuration must be an object.');
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > WIDGET_CONFIGURATION_MAX_BYTES) {
    throw validationError('Widget configuration is too large.');
  }
  return JSON.parse(serialized);
}

export function normalizeSavedView(input = {}, { partial = false } = {}) {
  if (!isPlainObject(input)) throw validationError('Saved view input must be an object.');
  const normalized = {};

  if (!partial || Object.hasOwn(input, 'name')) normalized.name = normalizeSavedViewName(input.name);
  if (!partial || Object.hasOwn(input, 'datePreset')) normalized.datePreset = normalizeDatePreset(input.datePreset);
  if (!partial || Object.hasOwn(input, 'filters')) {
    const datePreset = normalized.datePreset ?? normalizeDatePreset(input.datePreset ?? 'last_30_days');
    normalized.filters = normalizeSavedViewFilters(input.filters, datePreset);
  }
  if (!partial || Object.hasOwn(input, 'section')) normalized.section = normalizeSection(input.section ?? 'overview');
  if (!partial || Object.hasOwn(input, 'widgetConfiguration')) {
    normalized.widgetConfiguration = normalizeWidgetConfiguration(input.widgetConfiguration);
  }
  if (Object.hasOwn(input, 'isDefault')) normalized.isDefault = input.isDefault === true;

  if (partial && Object.keys(normalized).length === 0) {
    throw validationError('Provide at least one saved view field to update.');
  }
  return normalized;
}

function serialize(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    datePreset: row.date_preset,
    filters: row.filters ?? {},
    section: row.section,
    widgetConfiguration: row.widget_configuration ?? null,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listSavedViews(postgres, workspaceId, userId) {
  const result = await postgres.query(
    `SELECT id, workspace_id, name, date_preset, filters, section,
            widget_configuration, is_default, created_at, updated_at
     FROM saved_reporting_views
     WHERE workspace_id = $1 AND user_id = $2
     ORDER BY is_default DESC, updated_at DESC, lower(name)`,
    [workspaceId, userId]
  );
  return result.rows.map(serialize);
}

async function clearDefault(client, workspaceId, userId, excludingViewId = null) {
  await client.query(
    `UPDATE saved_reporting_views
     SET is_default = FALSE, updated_at = NOW()
     WHERE workspace_id = $1 AND user_id = $2 AND is_default = TRUE
       AND ($3::uuid IS NULL OR id <> $3::uuid)`,
    [workspaceId, userId, excludingViewId]
  );
}

export async function createSavedView(client, workspaceId, userId, rawInput) {
  const view = normalizeSavedView(rawInput);
  if (view.isDefault) await clearDefault(client, workspaceId, userId);
  const result = await client.query(
    `INSERT INTO saved_reporting_views (
       workspace_id, user_id, name, date_preset, filters, section,
       widget_configuration, is_default
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8)
     RETURNING id, workspace_id, name, date_preset, filters, section,
               widget_configuration, is_default, created_at, updated_at`,
    [
      workspaceId,
      userId,
      view.name,
      view.datePreset,
      JSON.stringify(view.filters),
      view.section,
      view.widgetConfiguration === null ? null : JSON.stringify(view.widgetConfiguration),
      view.isDefault === true
    ]
  );
  return serialize(result.rows[0]);
}

export async function updateSavedView(client, workspaceId, userId, viewId, rawInput) {
  const normalizedViewId = normalizeViewId(viewId);
  const view = normalizeSavedView(rawInput, { partial: true });
  if (view.isDefault) await clearDefault(client, workspaceId, userId, normalizedViewId);

  const values = [normalizedViewId, workspaceId, userId];
  const assignments = [];
  const columns = {
    name: ['name', (value) => value, ''],
    datePreset: ['date_preset', (value) => value, ''],
    filters: ['filters', (value) => JSON.stringify(value), '::jsonb'],
    section: ['section', (value) => value, ''],
    widgetConfiguration: ['widget_configuration', (value) => value === null ? null : JSON.stringify(value), '::jsonb'],
    isDefault: ['is_default', (value) => value, '']
  };
  for (const [key, value] of Object.entries(view)) {
    const [column, serializeValue, cast] = columns[key];
    values.push(serializeValue(value));
    assignments.push(`${column} = $${values.length}${cast}`);
  }

  const result = await client.query(
    `UPDATE saved_reporting_views
     SET ${assignments.join(', ')}, updated_at = NOW()
     WHERE id = $1 AND workspace_id = $2 AND user_id = $3
     RETURNING id, workspace_id, name, date_preset, filters, section,
               widget_configuration, is_default, created_at, updated_at`,
    values
  );
  if (result.rowCount === 0) throw notFoundError();
  return serialize(result.rows[0]);
}

export async function duplicateSavedView(client, workspaceId, userId, viewId, requestedName) {
  const normalizedViewId = normalizeViewId(viewId);
  const sourceResult = await client.query(
    `SELECT name, date_preset, filters, section, widget_configuration
     FROM saved_reporting_views
     WHERE id = $1 AND workspace_id = $2 AND user_id = $3
     LIMIT 1`,
    [normalizedViewId, workspaceId, userId]
  );
  if (sourceResult.rowCount === 0) throw notFoundError();

  const namesResult = await client.query(
    `SELECT lower(name) AS normalized_name
     FROM saved_reporting_views
     WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId]
  );
  const existingNames = new Set(namesResult.rows.map((row) => row.normalized_name));
  const source = sourceResult.rows[0];
  let name = requestedName ? normalizeSavedViewName(requestedName) : `${source.name} copy`.slice(0, VIEW_NAME_MAX_LENGTH);
  if (!requestedName) {
    let suffix = 2;
    while (existingNames.has(name.toLowerCase())) {
      const suffixText = ` copy ${suffix}`;
      name = `${source.name.slice(0, VIEW_NAME_MAX_LENGTH - suffixText.length)}${suffixText}`;
      suffix += 1;
    }
  }

  const result = await client.query(
    `INSERT INTO saved_reporting_views (
       workspace_id, user_id, name, date_preset, filters, section,
       widget_configuration, is_default
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, FALSE)
     RETURNING id, workspace_id, name, date_preset, filters, section,
               widget_configuration, is_default, created_at, updated_at`,
    [
      workspaceId,
      userId,
      name,
      source.date_preset,
      JSON.stringify(source.filters),
      source.section,
      source.widget_configuration === null ? null : JSON.stringify(source.widget_configuration)
    ]
  );
  return serialize(result.rows[0]);
}

export async function deleteSavedView(postgres, workspaceId, userId, viewId) {
  const normalizedViewId = normalizeViewId(viewId);
  const result = await postgres.query(
    `DELETE FROM saved_reporting_views
     WHERE id = $1 AND workspace_id = $2 AND user_id = $3
     RETURNING id, name, is_default`,
    [normalizedViewId, workspaceId, userId]
  );
  if (result.rowCount === 0) throw notFoundError();
  return result.rows[0];
}

function sendDatabaseError(error, reply) {
  if (error?.code === '23505') {
    return reply.code(409).send({
      error: 'saved_view_exists',
      message: 'A saved view with this name already exists.'
    });
  }
  throw error;
}

export function registerSavedViewRoutes(app, {
  postgres,
  withTransaction,
  requireViewer,
  writeAudit
}) {
  const basePath = '/api/v1/customer/workspaces/:workspaceId/saved-views';

  registerWorkspacePreferencesRoutes(app, {
    postgres,
    withTransaction,
    requireViewer,
    writeAudit
  });

  app.get(basePath, { preHandler: requireViewer }, async (request) => ({
    results: await listSavedViews(postgres, request.params.workspaceId, request.customer.user.id)
  }));

  app.post(basePath, { preHandler: requireViewer }, async (request, reply) => {
    try {
      const view = await withTransaction((client) => createSavedView(
        client,
        request.params.workspaceId,
        request.customer.user.id,
        request.body
      ));
      await writeAudit(request, {
        workspaceId: request.params.workspaceId,
        actorUserId: request.customer.user.id,
        action: 'reporting_view.created',
        targetType: 'saved_reporting_view',
        targetId: view.id,
        metadata: { name: view.name, isDefault: view.isDefault }
      });
      return reply.code(201).send(view);
    } catch (error) {
      return sendDatabaseError(error, reply);
    }
  });

  app.patch(`${basePath}/:viewId`, { preHandler: requireViewer }, async (request, reply) => {
    try {
      const view = await withTransaction((client) => updateSavedView(
        client,
        request.params.workspaceId,
        request.customer.user.id,
        request.params.viewId,
        request.body
      ));
      await writeAudit(request, {
        workspaceId: request.params.workspaceId,
        actorUserId: request.customer.user.id,
        action: 'reporting_view.updated',
        targetType: 'saved_reporting_view',
        targetId: view.id,
        metadata: { name: view.name, isDefault: view.isDefault }
      });
      return view;
    } catch (error) {
      return sendDatabaseError(error, reply);
    }
  });

  app.post(`${basePath}/:viewId/duplicate`, { preHandler: requireViewer }, async (request, reply) => {
    try {
      const view = await withTransaction((client) => duplicateSavedView(
        client,
        request.params.workspaceId,
        request.customer.user.id,
        request.params.viewId,
        request.body?.name
      ));
      await writeAudit(request, {
        workspaceId: request.params.workspaceId,
        actorUserId: request.customer.user.id,
        action: 'reporting_view.duplicated',
        targetType: 'saved_reporting_view',
        targetId: view.id,
        metadata: { sourceViewId: request.params.viewId, name: view.name }
      });
      return reply.code(201).send(view);
    } catch (error) {
      return sendDatabaseError(error, reply);
    }
  });

  app.delete(`${basePath}/:viewId`, { preHandler: requireViewer }, async (request, reply) => {
    const deleted = await deleteSavedView(
      postgres,
      request.params.workspaceId,
      request.customer.user.id,
      request.params.viewId
    );
    await writeAudit(request, {
      workspaceId: request.params.workspaceId,
      actorUserId: request.customer.user.id,
      action: 'reporting_view.deleted',
      targetType: 'saved_reporting_view',
      targetId: deleted.id,
      metadata: { name: deleted.name, wasDefault: deleted.is_default }
    });
    return reply.code(204).send();
  });
}
