const DATE_PRESETS = new Set([
  'today', 'yesterday', 'last_7_days', 'last_30_days', 'this_month',
  'previous_month', 'this_quarter', 'this_year', 'custom'
]);
const DASHBOARD_SECTIONS = new Set(['overview', 'activity', 'pipeline', 'sources', 'team', 'quality']);
const FILTER_KEYS = ['from', 'to', 'ownerId', 'country', 'pipelineId', 'stageId', 'leadSource'];

function text(value, max = 160) {
  const result = String(value ?? '').trim();
  return result ? result.slice(0, max) : '';
}

export function normalizeSavedView(input = {}) {
  const name = text(input.name, 100);
  if (name.length < 2) {
    const error = new Error('Saved view name must be between 2 and 100 characters.');
    error.statusCode = 400;
    error.category = 'INVALID_SAVED_VIEW';
    throw error;
  }
  const datePreset = DATE_PRESETS.has(input.datePreset) ? input.datePreset : 'last_30_days';
  const filters = {};
  for (const key of FILTER_KEYS) filters[key] = text(input.filters?.[key], 160);
  if (datePreset !== 'custom') {
    filters.from = '';
    filters.to = '';
  }
  if (datePreset === 'custom' && (!/^\d{4}-\d{2}-\d{2}$/.test(filters.from) || !/^\d{4}-\d{2}-\d{2}$/.test(filters.to))) {
    const error = new Error('Custom saved views require valid from and to dates.');
    error.statusCode = 400;
    error.category = 'INVALID_SAVED_VIEW_DATES';
    throw error;
  }
  return {
    name,
    datePreset,
    filters,
    section: DASHBOARD_SECTIONS.has(input.section) ? input.section : 'overview',
    isDefault: input.isDefault === true
  };
}

export async function ensureSavedViewsSchema(postgres) {
  await postgres.query(`
    CREATE TABLE IF NOT EXISTS saved_reporting_views (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      date_preset TEXT NOT NULL DEFAULT 'last_30_days',
      filters JSONB NOT NULL DEFAULT '{}'::jsonb,
      section TEXT NOT NULL DEFAULT 'overview',
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, user_id, name)
    );
    CREATE INDEX IF NOT EXISTS saved_reporting_views_user_workspace_idx
      ON saved_reporting_views(user_id, workspace_id, updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS saved_reporting_views_one_default_idx
      ON saved_reporting_views(workspace_id, user_id)
      WHERE is_default = TRUE;
  `);
}

function serialize(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    datePreset: row.date_preset,
    filters: row.filters ?? {},
    section: row.section,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function registerSavedViewRoutes(app, { postgres, customerAuth }) {
  const requireViewer = [
    customerAuth.requireCustomer,
    (request, reply) => customerAuth.requireWorkspaceRole(request, reply, 'viewer')
  ];

  app.get('/api/v1/customer/workspaces/:workspaceId/saved-views', { preHandler: requireViewer }, async (request) => {
    const result = await postgres.query(
      `SELECT * FROM saved_reporting_views
       WHERE workspace_id = $1 AND user_id = $2
       ORDER BY is_default DESC, updated_at DESC, name`,
      [request.params.workspaceId, request.customer.user.id]
    );
    return { results: result.rows.map(serialize) };
  });

  app.post('/api/v1/customer/workspaces/:workspaceId/saved-views', { preHandler: requireViewer }, async (request, reply) => {
    const view = normalizeSavedView(request.body);
    if (view.isDefault) {
      await postgres.query(
        `UPDATE saved_reporting_views SET is_default = FALSE, updated_at = NOW()
         WHERE workspace_id = $1 AND user_id = $2 AND is_default = TRUE`,
        [request.params.workspaceId, request.customer.user.id]
      );
    }
    try {
      const result = await postgres.query(
        `INSERT INTO saved_reporting_views(workspace_id, user_id, name, date_preset, filters, section, is_default)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         RETURNING *`,
        [request.params.workspaceId, request.customer.user.id, view.name, view.datePreset, JSON.stringify(view.filters), view.section, view.isDefault]
      );
      await customerAuth.writeAudit(request, {
        workspaceId: request.params.workspaceId,
        actorUserId: request.customer.user.id,
        action: 'reporting_view.created',
        targetType: 'saved_reporting_view',
        targetId: result.rows[0].id,
        metadata: { name: view.name, isDefault: view.isDefault }
      });
      return reply.code(201).send(serialize(result.rows[0]));
    } catch (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'saved_view_exists', message: 'A saved view with this name already exists.' });
      throw error;
    }
  });

  app.patch('/api/v1/customer/workspaces/:workspaceId/saved-views/:viewId', { preHandler: requireViewer }, async (request, reply) => {
    const view = normalizeSavedView(request.body);
    if (view.isDefault) {
      await postgres.query(
        `UPDATE saved_reporting_views SET is_default = FALSE, updated_at = NOW()
         WHERE workspace_id = $1 AND user_id = $2 AND id <> $3 AND is_default = TRUE`,
        [request.params.workspaceId, request.customer.user.id, request.params.viewId]
      );
    }
    try {
      const result = await postgres.query(
        `UPDATE saved_reporting_views
         SET name = $4, date_preset = $5, filters = $6::jsonb, section = $7,
             is_default = $8, updated_at = NOW()
         WHERE workspace_id = $1 AND user_id = $2 AND id = $3
         RETURNING *`,
        [request.params.workspaceId, request.customer.user.id, request.params.viewId, view.name, view.datePreset, JSON.stringify(view.filters), view.section, view.isDefault]
      );
      if (result.rowCount === 0) return reply.code(404).send({ error: 'saved_view_not_found', message: 'Saved view not found.' });
      await customerAuth.writeAudit(request, {
        workspaceId: request.params.workspaceId,
        actorUserId: request.customer.user.id,
        action: 'reporting_view.updated',
        targetType: 'saved_reporting_view',
        targetId: request.params.viewId,
        metadata: { name: view.name, isDefault: view.isDefault }
      });
      return serialize(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'saved_view_exists', message: 'A saved view with this name already exists.' });
      throw error;
    }
  });

  app.post('/api/v1/customer/workspaces/:workspaceId/saved-views/:viewId/duplicate', { preHandler: requireViewer }, async (request, reply) => {
    const source = await postgres.query(
      `SELECT * FROM saved_reporting_views WHERE workspace_id = $1 AND user_id = $2 AND id = $3 LIMIT 1`,
      [request.params.workspaceId, request.customer.user.id, request.params.viewId]
    );
    if (source.rowCount === 0) return reply.code(404).send({ error: 'saved_view_not_found', message: 'Saved view not found.' });
    const baseName = text(request.body?.name || `${source.rows[0].name} copy`, 100);
    const result = await postgres.query(
      `INSERT INTO saved_reporting_views(workspace_id, user_id, name, date_preset, filters, section, is_default)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, FALSE)
       RETURNING *`,
      [request.params.workspaceId, request.customer.user.id, baseName, source.rows[0].date_preset, JSON.stringify(source.rows[0].filters), source.rows[0].section]
    );
    return reply.code(201).send(serialize(result.rows[0]));
  });

  app.delete('/api/v1/customer/workspaces/:workspaceId/saved-views/:viewId', { preHandler: requireViewer }, async (request, reply) => {
    const result = await postgres.query(
      `DELETE FROM saved_reporting_views
       WHERE workspace_id = $1 AND user_id = $2 AND id = $3
       RETURNING id, name`,
      [request.params.workspaceId, request.customer.user.id, request.params.viewId]
    );
    if (result.rowCount === 0) return reply.code(404).send({ error: 'saved_view_not_found', message: 'Saved view not found.' });
    await customerAuth.writeAudit(request, {
      workspaceId: request.params.workspaceId,
      actorUserId: request.customer.user.id,
      action: 'reporting_view.deleted',
      targetType: 'saved_reporting_view',
      targetId: request.params.viewId,
      metadata: { name: result.rows[0].name }
    });
    return reply.code(204).send();
  });
}
