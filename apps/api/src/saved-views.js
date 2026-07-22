import { hashValue } from './crypto.js';

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
  const filters = Object.fromEntries(FILTER_KEYS.map((key) => [key, text(input.filters?.[key], 160)]));
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
      date_preset TEXT NOT NULL DEFAULT 'last_30_days'
        CHECK (date_preset IN ('today','yesterday','last_7_days','last_30_days','this_month','previous_month','this_quarter','this_year','custom')),
      filters JSONB NOT NULL DEFAULT '{}'::jsonb,
      section TEXT NOT NULL DEFAULT 'overview'
        CHECK (section IN ('overview','activity','pipeline','sources','team','quality')),
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

async function writeAudit(postgres, request, action, targetId, metadata) {
  await postgres.query(
    `INSERT INTO audit_events(workspace_id, actor_user_id, action, target_type, target_id, metadata, ip_hash)
     VALUES ($1, $2, $3, 'saved_reporting_view', $4, $5::jsonb, $6)`,
    [request.savedViewAccess.workspaceId, request.savedViewAccess.userId, action, targetId, JSON.stringify(metadata), request.ip ? hashValue(request.ip) : null]
  );
}

export function registerSavedViewRoutes(app, { postgres }) {
  const schemaReady = ensureSavedViewsSchema(postgres);

  async function requireSavedViewAccess(request, reply) {
    await schemaReady;
    const token = String(request.headers['x-session-token'] ?? '').trim();
    if (!token) return reply.code(401).send({ error: 'customer_session_required', message: 'Sign in to continue.' });
    const result = await postgres.query(
      `SELECT u.id AS user_id, m.workspace_id
       FROM user_sessions s
       JOIN app_users u ON u.id = s.user_id AND u.status = 'active'
       JOIN workspace_memberships m ON m.user_id = u.id AND m.workspace_id = $2
       WHERE s.token_hash = $1 AND s.expires_at > NOW()
       LIMIT 1`,
      [hashValue(token), request.params.workspaceId]
    );
    if (result.rowCount === 0) {
      return reply.code(403).send({ error: 'workspace_forbidden', message: 'This workspace is not available to your account.' });
    }
    request.savedViewAccess = {
      userId: result.rows[0].user_id,
      workspaceId: result.rows[0].workspace_id
    };
  }

  app.get('/api/v1/customer/workspaces/:workspaceId/saved-views', { preHandler: requireSavedViewAccess }, async (request) => {
    const result = await postgres.query(
      `SELECT * FROM saved_reporting_views
       WHERE workspace_id = $1 AND user_id = $2
       ORDER BY is_default DESC, updated_at DESC, name`,
      [request.savedViewAccess.workspaceId, request.savedViewAccess.userId]
    );
    return { results: result.rows.map(serialize) };
  });

  app.post('/api/v1/customer/workspaces/:workspaceId/saved-views', { preHandler: requireSavedViewAccess }, async (request, reply) => {
    const view = normalizeSavedView(request.body);
    try {
      const result = await postgres.query('BEGIN');
      try {
        if (view.isDefault) {
          await postgres.query(
            `UPDATE saved_reporting_views SET is_default = FALSE, updated_at = NOW()
             WHERE workspace_id = $1 AND user_id = $2 AND is_default = TRUE`,
            [request.savedViewAccess.workspaceId, request.savedViewAccess.userId]
          );
        }
        const created = await postgres.query(
          `INSERT INTO saved_reporting_views(workspace_id, user_id, name, date_preset, filters, section, is_default)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
           RETURNING *`,
          [request.savedViewAccess.workspaceId, request.savedViewAccess.userId, view.name, view.datePreset, JSON.stringify(view.filters), view.section, view.isDefault]
        );
        await postgres.query('COMMIT');
        await writeAudit(postgres, request, 'reporting_view.created', created.rows[0].id, { name: view.name, isDefault: view.isDefault });
        return reply.code(201).send(serialize(created.rows[0]));
      } catch (error) {
        await postgres.query('ROLLBACK');
        throw error;
      }
    } catch (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'saved_view_exists', message: 'A saved view with this name already exists.' });
      throw error;
    }
  });

  app.patch('/api/v1/customer/workspaces/:workspaceId/saved-views/:viewId', { preHandler: requireSavedViewAccess }, async (request, reply) => {
    const view = normalizeSavedView(request.body);
    try {
      await postgres.query('BEGIN');
      try {
        if (view.isDefault) {
          await postgres.query(
            `UPDATE saved_reporting_views SET is_default = FALSE, updated_at = NOW()
             WHERE workspace_id = $1 AND user_id = $2 AND id <> $3 AND is_default = TRUE`,
            [request.savedViewAccess.workspaceId, request.savedViewAccess.userId, request.params.viewId]
          );
        }
        const result = await postgres.query(
          `UPDATE saved_reporting_views
           SET name = $4, date_preset = $5, filters = $6::jsonb, section = $7, is_default = $8, updated_at = NOW()
           WHERE workspace_id = $1 AND user_id = $2 AND id = $3
           RETURNING *`,
          [request.savedViewAccess.workspaceId, request.savedViewAccess.userId, request.params.viewId, view.name, view.datePreset, JSON.stringify(view.filters), view.section, view.isDefault]
        );
        if (result.rowCount === 0) {
          await postgres.query('ROLLBACK');
          return reply.code(404).send({ error: 'saved_view_not_found', message: 'Saved view not found.' });
        }
        await postgres.query('COMMIT');
        await writeAudit(postgres, request, 'reporting_view.updated', request.params.viewId, { name: view.name, isDefault: view.isDefault });
        return serialize(result.rows[0]);
      } catch (error) {
        await postgres.query('ROLLBACK');
        throw error;
      }
    } catch (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'saved_view_exists', message: 'A saved view with this name already exists.' });
      throw error;
    }
  });

  app.post('/api/v1/customer/workspaces/:workspaceId/saved-views/:viewId/duplicate', { preHandler: requireSavedViewAccess }, async (request, reply) => {
    const name = text(request.body?.name, 100);
    if (name.length < 2) return reply.code(400).send({ error: 'invalid_saved_view', message: 'Enter a name for the duplicated view.' });
    try {
      const result = await postgres.query(
        `INSERT INTO saved_reporting_views(workspace_id, user_id, name, date_preset, filters, section, is_default)
         SELECT workspace_id, user_id, $4, date_preset, filters, section, FALSE
         FROM saved_reporting_views
         WHERE workspace_id = $1 AND user_id = $2 AND id = $3
         RETURNING *`,
        [request.savedViewAccess.workspaceId, request.savedViewAccess.userId, request.params.viewId, name]
      );
      if (result.rowCount === 0) return reply.code(404).send({ error: 'saved_view_not_found', message: 'Saved view not found.' });
      await writeAudit(postgres, request, 'reporting_view.duplicated', result.rows[0].id, { name, sourceId: request.params.viewId });
      return reply.code(201).send(serialize(result.rows[0]));
    } catch (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'saved_view_exists', message: 'A saved view with this name already exists.' });
      throw error;
    }
  });

  app.delete('/api/v1/customer/workspaces/:workspaceId/saved-views/:viewId', { preHandler: requireSavedViewAccess }, async (request, reply) => {
    const result = await postgres.query(
      `DELETE FROM saved_reporting_views
       WHERE workspace_id = $1 AND user_id = $2 AND id = $3
       RETURNING id, name`,
      [request.savedViewAccess.workspaceId, request.savedViewAccess.userId, request.params.viewId]
    );
    if (result.rowCount === 0) return reply.code(404).send({ error: 'saved_view_not_found', message: 'Saved view not found.' });
    await writeAudit(postgres, request, 'reporting_view.deleted', request.params.viewId, { name: result.rows[0].name });
    return reply.code(204).send();
  });
}
