import {
  getConnectionForWorkspace,
  getValidAccessToken,
  hubSpotPatch,
  hubSpotPost,
  hubSpotPut
} from './hubspot.js';

const ACTION_SCOPES = Object.freeze({
  createTask: ['crm.objects.tasks.write'],
  updateLifecycleStage: ['crm.objects.contacts.write'],
  markReviewed: []
});

const REVIEWABLE_OBJECTS = new Set(['contacts', 'companies', 'deals', 'tasks', 'calls', 'meetings']);
const TASK_TARGET_OBJECTS = new Set(['contacts', 'companies', 'deals']);
const LIFECYCLE_STAGES = new Set([
  'subscriber',
  'lead',
  'marketingqualifiedlead',
  'salesqualifiedlead',
  'opportunity',
  'customer',
  'evangelist',
  'other'
]);

function validationError(message, category = 'INVALID_OPS_ACTION') {
  const error = new Error(message);
  error.statusCode = 400;
  error.category = category;
  return error;
}

function forbiddenError(message, details = {}) {
  const error = new Error(message);
  error.statusCode = 403;
  error.category = 'HUBSPOT_WRITE_SCOPE_REQUIRED';
  error.details = details;
  return error;
}

function unavailableError(message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.category = 'HUBSPOT_CONNECTION_REQUIRED';
  return error;
}

function normalizeId(value, label = 'record ID') {
  const id = String(value ?? '').trim();
  if (!/^[0-9A-Za-z_-]{1,128}$/.test(id)) throw validationError(`Choose a valid ${label}.`);
  return id;
}

function normalizeObjectType(value, allowed, label = 'object type') {
  const objectType = String(value ?? '').trim().toLowerCase();
  if (!allowed.has(objectType)) throw validationError(`Choose a supported ${label}.`);
  return objectType;
}

function normalizeText(value, { label, min = 1, max = 500 }) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (text.length < min || text.length > max) {
    throw validationError(`${label} must be between ${min} and ${max} characters.`);
  }
  return text;
}

function normalizeOptionalText(value, { max = 2000 } = {}) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text.length > max) throw validationError(`Text cannot exceed ${max} characters.`);
  return text;
}

function normalizeDueAt(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw validationError('Choose a valid task due date.');
  return date.toISOString();
}

function normalizeScopes(value) {
  if (Array.isArray(value)) return new Set(value.map(String));
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return new Set(parsed.map(String));
    } catch {
      return new Set(value.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean));
    }
  }
  return new Set();
}

function missingScopes(connection, requiredScopes) {
  const granted = normalizeScopes(connection?.scopes);
  return requiredScopes.filter((scope) => !granted.has(scope));
}

async function requireConnection(workspaceId) {
  const connection = await getConnectionForWorkspace(workspaceId);
  if (!connection) throw unavailableError('Connect HubSpot before using Ops Actions.');
  return connection;
}

async function requireScopes(connection, action) {
  const missing = missingScopes(connection, ACTION_SCOPES[action]);
  if (missing.length) {
    throw forbiddenError('Reconnect HubSpot with write permissions before using this action.', {
      action,
      missingScopes: missing
    });
  }
}

export async function ensureOpsActionsSchema(postgres) {
  await postgres.query(`
    CREATE TABLE IF NOT EXISTS ops_record_reviews (
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      object_type TEXT NOT NULL,
      record_id TEXT NOT NULL,
      reviewed_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      note TEXT,
      PRIMARY KEY (workspace_id, object_type, record_id)
    );

    CREATE INDEX IF NOT EXISTS ops_record_reviews_workspace_reviewed_idx
      ON ops_record_reviews(workspace_id, reviewed_at DESC);
  `);
}

function capabilities(connection) {
  const scopes = normalizeScopes(connection?.scopes);
  const can = Object.fromEntries(Object.entries(ACTION_SCOPES).map(([key, required]) => [
    key,
    required.every((scope) => scopes.has(scope))
  ]));
  return {
    connected: Boolean(connection),
    scopes: [...scopes].sort(),
    requiredScopes: ACTION_SCOPES,
    can
  };
}

async function associateTask(accessToken, taskId, objectType, recordId) {
  try {
    await hubSpotPut(
      `/crm/v4/objects/tasks/${encodeURIComponent(taskId)}/associations/default/${encodeURIComponent(objectType)}/${encodeURIComponent(recordId)}`,
      accessToken
    );
    return null;
  } catch (error) {
    return error.message || 'Task was created, but HubSpot did not accept the record association.';
  }
}

export function registerOpsActionsRoutes(app, { postgres, requireAdmin, writeAudit }) {
  const basePath = '/api/v1/customer/workspaces/:workspaceId/actions';

  app.get(`${basePath}/capabilities`, { preHandler: requireAdmin }, async (request) => {
    const connection = await getConnectionForWorkspace(request.params.workspaceId);
    return capabilities(connection);
  });

  app.post(`${basePath}/tasks`, { preHandler: requireAdmin }, async (request, reply) => {
    const workspaceId = request.params.workspaceId;
    const objectType = normalizeObjectType(request.body?.objectType, TASK_TARGET_OBJECTS, 'task target object type');
    const recordId = normalizeId(request.body?.recordId);
    const subject = normalizeText(request.body?.subject, { label: 'Task subject', max: 160 });
    const body = normalizeOptionalText(request.body?.body, { max: 2000 });
    const dueAt = normalizeDueAt(request.body?.dueAt);
    const ownerId = String(request.body?.ownerId ?? '').trim();

    const connection = await requireConnection(workspaceId);
    await requireScopes(connection, 'createTask');
    const accessToken = await getValidAccessToken(connection);
    const properties = {
      hs_task_subject: subject,
      hs_task_body: body || `Created by Ops Actions for ${objectType} ${recordId}.`,
      hs_timestamp: dueAt,
      hs_task_status: 'NOT_STARTED',
      hs_task_priority: String(request.body?.priority ?? 'MEDIUM').toUpperCase() === 'HIGH' ? 'HIGH' : 'MEDIUM'
    };
    if (/^\d+$/.test(ownerId)) properties.hubspot_owner_id = ownerId;

    const task = await hubSpotPost('/crm/v3/objects/tasks', accessToken, { properties });
    const associationWarning = task?.id ? await associateTask(accessToken, task.id, objectType, recordId) : null;

    await writeAudit(request, {
      workspaceId,
      actorUserId: request.customer.user.id,
      action: 'ops_action.task_created',
      targetType: objectType,
      targetId: recordId,
      metadata: { taskId: task?.id ?? null, subject, associationWarning }
    });

    return reply.code(201).send({
      status: associationWarning ? 'created_with_warning' : 'created',
      taskId: task?.id ?? null,
      associationWarning
    });
  });

  app.patch(`${basePath}/contacts/:contactId/lifecycle-stage`, { preHandler: requireAdmin }, async (request) => {
    const workspaceId = request.params.workspaceId;
    const contactId = normalizeId(request.params.contactId, 'contact ID');
    const lifecycleStage = String(request.body?.lifecycleStage ?? '').trim().toLowerCase();
    if (!LIFECYCLE_STAGES.has(lifecycleStage)) throw validationError('Choose a supported lifecycle stage.');

    const connection = await requireConnection(workspaceId);
    await requireScopes(connection, 'updateLifecycleStage');
    const accessToken = await getValidAccessToken(connection);
    const updated = await hubSpotPatch(`/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`, accessToken, {
      properties: { lifecyclestage: lifecycleStage }
    });

    await writeAudit(request, {
      workspaceId,
      actorUserId: request.customer.user.id,
      action: 'ops_action.lifecycle_stage_updated',
      targetType: 'contacts',
      targetId: contactId,
      metadata: { lifecycleStage }
    });

    return { status: 'updated', contactId: updated?.id ?? contactId, lifecycleStage };
  });

  app.post(`${basePath}/records/reviewed`, { preHandler: requireAdmin }, async (request) => {
    const workspaceId = request.params.workspaceId;
    const objectType = normalizeObjectType(request.body?.objectType, REVIEWABLE_OBJECTS);
    const recordId = normalizeId(request.body?.recordId);
    const note = normalizeOptionalText(request.body?.note, { max: 1000 });

    await postgres.query(
      `INSERT INTO ops_record_reviews(workspace_id, object_type, record_id, reviewed_by, reviewed_at, note)
       VALUES ($1, $2, $3, $4, NOW(), $5)
       ON CONFLICT (workspace_id, object_type, record_id)
       DO UPDATE SET reviewed_by = EXCLUDED.reviewed_by, reviewed_at = NOW(), note = EXCLUDED.note`,
      [workspaceId, objectType, recordId, request.customer.user.id, note || null]
    );

    await writeAudit(request, {
      workspaceId,
      actorUserId: request.customer.user.id,
      action: 'ops_action.record_reviewed',
      targetType: objectType,
      targetId: recordId,
      metadata: { note: note || null }
    });

    return { status: 'reviewed', objectType, recordId };
  });
}
