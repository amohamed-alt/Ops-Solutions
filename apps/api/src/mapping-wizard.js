import { inferValueMapping } from './semantic.js';

const MIGRATION_VERSION = 4;
const MIGRATION_NAME = 'property_mapping_version_history';
const MIGRATION_LOCK = 812341233;
const MAX_VALUE_MAPPING_ENTRIES = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEPENDENCIES = Object.freeze({
  lead_quality: ['Priority lead queues', 'Lead quality coverage', 'Conversion by quality'],
  lead_source: ['Source performance', 'Acquisition attribution', 'Source conversion'],
  market: ['Market distribution', 'Territory performance'],
  country: ['Country filters', 'Market distribution', 'Country coverage'],
  product: ['Product filters', 'Pipeline by product', 'Revenue mix'],
  customer_segment: ['Segment filters', 'Portfolio segmentation'],
  account_status: ['Customer health', 'Retention segmentation'],
  meeting_outcome: ['Meeting outcomes', 'Meeting completion rate'],
  call_outcome: ['Call dispositions', 'Connection rate'],
  renewal_date: ['Renewal calendar', 'Upcoming and delayed renewals'],
  revenue: ['Pipeline value', 'Won revenue', 'Revenue reporting']
});

const MAPPING_HISTORY_SQL = `
  CREATE TABLE IF NOT EXISTS property_mapping_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    mapping_id UUID REFERENCES property_mappings(id) ON DELETE SET NULL,
    semantic_key TEXT NOT NULL REFERENCES semantic_fields(semantic_key) ON DELETE CASCADE,
    object_type TEXT NOT NULL,
    property_name TEXT,
    value_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
    source TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('approved', 'updated', 'rolled_back', 'removed')),
    actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
    snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS property_mapping_versions_workspace_created_idx
    ON property_mapping_versions(workspace_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS property_mapping_versions_slot_idx
    ON property_mapping_versions(workspace_id, semantic_key, object_type, created_at DESC);
`;

export const MAPPING_HISTORY_ROLLBACK_SQL = 'DROP TABLE IF EXISTS property_mapping_versions;';

function mappingError(message, statusCode = 400, category = 'INVALID_MAPPING') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.category = category;
  return error;
}

function cleanToken(value, maxLength = 160) {
  return String(value ?? '').trim().slice(0, maxLength);
}

export function confidenceBand(value) {
  const confidence = Number(value || 0);
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.55) return 'medium';
  return 'low';
}

export function mappingDependencies(semanticKey) {
  return [...(DEPENDENCIES[semanticKey] ?? ['Custom reporting and filters'])];
}

export function normalizeValueMapping(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw mappingError('Value mapping must be an object of HubSpot values and normalized values.');
  }

  const entries = Object.entries(value);
  if (entries.length > MAX_VALUE_MAPPING_ENTRIES) {
    throw mappingError(`Value mapping cannot contain more than ${MAX_VALUE_MAPPING_ENTRIES} entries.`);
  }

  const normalized = {};
  for (const [rawKey, rawValue] of entries) {
    const key = cleanToken(rawKey, 160);
    const target = cleanToken(rawValue, 100);
    if (!key || !target) continue;
    normalized[key] = target;
  }
  return normalized;
}

export async function ensureMappingWizardSchema(postgres) {
  const client = await postgres.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${MIGRATION_LOCK})`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const existing = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [MIGRATION_VERSION]);
    if (existing.rowCount > 0) return { applied: false, version: MIGRATION_VERSION };

    await client.query('BEGIN');
    try {
      await client.query(MAPPING_HISTORY_SQL);
      await client.query(
        'INSERT INTO schema_migrations(version, name) VALUES ($1, $2)',
        [MIGRATION_VERSION, MIGRATION_NAME]
      );
      await client.query('COMMIT');
      return { applied: true, version: MIGRATION_VERSION };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${MIGRATION_LOCK})`).catch(() => undefined);
    client.release();
  }
}

async function loadSampleValues(postgres, workspaceId) {
  try {
    const result = await postgres.query(
      `WITH target_properties AS (
         SELECT DISTINCT object_type, property_name
         FROM property_mapping_suggestions
         WHERE workspace_id = $1
         UNION
         SELECT DISTINCT object_type, property_name
         FROM property_mappings
         WHERE workspace_id = $1
       ), samples AS (
         SELECT target.object_type, target.property_name, sample.value
         FROM target_properties target
         CROSS JOIN LATERAL (
           SELECT DISTINCT LEFT(record.properties ->> target.property_name, 160) AS value
           FROM crm_records record
           WHERE record.workspace_id = $1
             AND record.object_type = target.object_type
             AND record.archived = FALSE
             AND NULLIF(BTRIM(record.properties ->> target.property_name), '') IS NOT NULL
           LIMIT 8
         ) sample
       )
       SELECT object_type, property_name, JSON_AGG(value ORDER BY value) AS values
       FROM samples
       GROUP BY object_type, property_name`,
      [workspaceId]
    );
    return new Map(result.rows.map((row) => [`${row.object_type}:${row.property_name}`, row.values ?? []]));
  } catch (error) {
    if (error.code === '42P01') return new Map();
    throw error;
  }
}

function decorateProperty(row, samples) {
  const options = Array.isArray(row.options) ? row.options.slice(0, 100) : [];
  return {
    objectType: row.object_type,
    propertyName: row.property_name,
    label: row.label,
    description: row.description,
    groupName: row.group_name,
    fieldType: row.field_type,
    dataType: row.data_type,
    hubspotDefined: Boolean(row.hubspot_defined),
    options,
    optionCount: Array.isArray(row.options) ? row.options.length : 0,
    sampleValues: samples.get(`${row.object_type}:${row.property_name}`) ?? [],
    discoveredAt: row.discovered_at
  };
}

export async function loadMappingWizard(postgres, workspaceId) {
  const [fieldsResult, propertiesResult, suggestionsResult, mappingsResult, historyResult, discoveryResult, samples] = await Promise.all([
    postgres.query(
      `SELECT semantic_key, label, description, object_types, expected_types
       FROM semantic_fields
       ORDER BY label`,
      []
    ),
    postgres.query(
      `SELECT object_type, property_name, label, description, group_name,
              field_type, data_type, hubspot_defined, options, discovered_at
       FROM crm_properties
       WHERE workspace_id = $1
       ORDER BY object_type, hubspot_defined, label
       LIMIT 5000`,
      [workspaceId]
    ),
    postgres.query(
      `SELECT s.id, s.semantic_key, s.object_type, s.property_name, s.confidence,
              s.reasons, s.status, s.updated_at,
              p.label AS property_label, p.description AS property_description,
              p.field_type, p.data_type, p.options
       FROM property_mapping_suggestions s
       JOIN crm_properties p
         ON p.workspace_id = s.workspace_id
        AND p.object_type = s.object_type
        AND p.property_name = s.property_name
       WHERE s.workspace_id = $1
       ORDER BY s.semantic_key, s.object_type, s.confidence DESC`,
      [workspaceId]
    ),
    postgres.query(
      `SELECT m.id, m.semantic_key, m.object_type, m.property_name, m.value_mapping,
              m.source, m.approved_by, m.created_at, m.updated_at,
              p.label AS property_label, p.description AS property_description,
              p.field_type, p.data_type, p.options,
              (p.property_name IS NULL) AS stale
       FROM property_mappings m
       LEFT JOIN crm_properties p
         ON p.workspace_id = m.workspace_id
        AND p.object_type = m.object_type
        AND p.property_name = m.property_name
       WHERE m.workspace_id = $1
       ORDER BY m.semantic_key, m.object_type`,
      [workspaceId]
    ),
    postgres.query(
      `SELECT v.id, v.mapping_id, v.semantic_key, v.object_type, v.property_name,
              v.value_mapping, v.source, v.action, v.snapshot, v.created_at,
              u.display_name AS actor_name, u.email AS actor_email
       FROM property_mapping_versions v
       LEFT JOIN app_users u ON u.id = v.actor_user_id
       WHERE v.workspace_id = $1
       ORDER BY v.created_at DESC
       LIMIT 100`,
      [workspaceId]
    ),
    postgres.query(
      `SELECT status, summary, error, started_at, completed_at
       FROM discovery_runs
       WHERE workspace_id = $1
       ORDER BY started_at DESC
       LIMIT 1`,
      [workspaceId]
    ),
    loadSampleValues(postgres, workspaceId)
  ]);

  const properties = propertiesResult.rows.map((row) => decorateProperty(row, samples));
  const propertyLookup = new Map(properties.map((property) => [`${property.objectType}:${property.propertyName}`, property]));

  const suggestions = suggestionsResult.rows.map((row) => ({
    id: row.id,
    semanticKey: row.semantic_key,
    objectType: row.object_type,
    propertyName: row.property_name,
    propertyLabel: row.property_label,
    propertyDescription: row.property_description,
    fieldType: row.field_type,
    dataType: row.data_type,
    confidence: Number(row.confidence),
    confidenceBand: confidenceBand(row.confidence),
    reasons: row.reasons ?? [],
    status: row.status,
    inferredValueMapping: inferValueMapping(row.semantic_key, row.options),
    sampleValues: propertyLookup.get(`${row.object_type}:${row.property_name}`)?.sampleValues ?? [],
    updatedAt: row.updated_at
  }));

  const mappings = mappingsResult.rows.map((row) => ({
    id: row.id,
    semanticKey: row.semantic_key,
    objectType: row.object_type,
    propertyName: row.property_name,
    propertyLabel: row.property_label ?? row.property_name,
    propertyDescription: row.property_description ?? '',
    fieldType: row.field_type,
    dataType: row.data_type,
    options: Array.isArray(row.options) ? row.options.slice(0, 100) : [],
    valueMapping: row.value_mapping ?? {},
    source: row.source,
    approvedBy: row.approved_by,
    stale: Boolean(row.stale),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  const semanticFields = fieldsResult.rows.map((row) => ({
    semanticKey: row.semantic_key,
    label: row.label,
    description: row.description,
    objectTypes: row.object_types ?? [],
    expectedTypes: row.expected_types ?? [],
    dependencies: mappingDependencies(row.semantic_key)
  }));

  const mappedSlots = new Set(mappings.map((mapping) => `${mapping.semanticKey}:${mapping.objectType}`));
  const allSlots = semanticFields.reduce((total, field) => total + field.objectTypes.length, 0);
  const highConfidenceSlots = new Set(
    suggestions
      .filter((suggestion) => suggestion.status === 'suggested' && suggestion.confidenceBand === 'high')
      .map((suggestion) => `${suggestion.semanticKey}:${suggestion.objectType}`)
  );

  return {
    summary: {
      semanticFields: semanticFields.length,
      totalSlots: allSlots,
      mappedSlots: mappedSlots.size,
      unmappedSlots: Math.max(0, allSlots - mappedSlots.size),
      pendingSuggestions: suggestions.filter((suggestion) => suggestion.status === 'suggested').length,
      highConfidenceSlots: highConfidenceSlots.size,
      staleMappings: mappings.filter((mapping) => mapping.stale).length,
      discoveredProperties: properties.length
    },
    semanticFields,
    properties,
    suggestions,
    mappings,
    history: historyResult.rows.map((row) => ({
      id: row.id,
      mappingId: row.mapping_id,
      semanticKey: row.semantic_key,
      objectType: row.object_type,
      propertyName: row.property_name,
      valueMapping: row.value_mapping ?? {},
      source: row.source,
      action: row.action,
      snapshot: row.snapshot ?? {},
      actorName: row.actor_name,
      actorEmail: row.actor_email,
      createdAt: row.created_at
    })),
    latestDiscovery: discoveryResult.rows[0] ?? null
  };
}

async function validateSlotAndProperty(postgres, workspaceId, semanticKey, objectType, propertyName) {
  const semanticResult = await postgres.query(
    `SELECT semantic_key, object_types
     FROM semantic_fields
     WHERE semantic_key = $1
     LIMIT 1`,
    [semanticKey]
  );
  const field = semanticResult.rows[0];
  if (!field) throw mappingError('Semantic field not found.', 404, 'SEMANTIC_FIELD_NOT_FOUND');
  if (!Array.isArray(field.object_types) || !field.object_types.includes(objectType)) {
    throw mappingError('This semantic field cannot be mapped to the selected object type.');
  }

  const propertyResult = await postgres.query(
    `SELECT property_name, label, options
     FROM crm_properties
     WHERE workspace_id = $1 AND object_type = $2 AND property_name = $3
     LIMIT 1`,
    [workspaceId, objectType, propertyName]
  );
  if (propertyResult.rowCount === 0) {
    throw mappingError('The selected HubSpot property is not available in the latest discovery.', 404, 'PROPERTY_NOT_FOUND');
  }
  return propertyResult.rows[0];
}

async function saveMapping({ postgres, withTransaction, workspaceId, user, semanticKey, objectType, propertyName, suppliedValueMapping, source = 'customer_approved', actionOverride = null, snapshot = {} }) {
  const property = await validateSlotAndProperty(postgres, workspaceId, semanticKey, objectType, propertyName);
  const normalized = normalizeValueMapping(suppliedValueMapping);
  const valueMapping = normalized === null ? inferValueMapping(semanticKey, property.options) : normalized;

  return withTransaction(async (client) => {
    const existing = await client.query(
      `SELECT id, property_name, value_mapping
       FROM property_mappings
       WHERE workspace_id = $1 AND semantic_key = $2 AND object_type = $3
       FOR UPDATE`,
      [workspaceId, semanticKey, objectType]
    );
    const action = actionOverride ?? (existing.rowCount > 0 ? 'updated' : 'approved');
    const result = await client.query(
      `INSERT INTO property_mappings (
         workspace_id, semantic_key, object_type, property_name,
         value_mapping, source, approved_by, updated_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, NOW())
       ON CONFLICT (workspace_id, semantic_key, object_type)
       DO UPDATE SET property_name = EXCLUDED.property_name,
                     value_mapping = EXCLUDED.value_mapping,
                     source = EXCLUDED.source,
                     approved_by = EXCLUDED.approved_by,
                     updated_at = NOW()
       RETURNING *`,
      [workspaceId, semanticKey, objectType, propertyName, JSON.stringify(valueMapping), source, user.email]
    );
    const mapping = result.rows[0];
    const versionResult = await client.query(
      `INSERT INTO property_mapping_versions (
         workspace_id, mapping_id, semantic_key, object_type, property_name,
         value_mapping, source, action, actor_user_id, snapshot
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb)
       RETURNING id, created_at`,
      [
        workspaceId,
        mapping.id,
        semanticKey,
        objectType,
        propertyName,
        JSON.stringify(valueMapping),
        source,
        action,
        user.id,
        JSON.stringify({
          previous: existing.rows[0] ?? null,
          ...snapshot
        })
      ]
    );
    await client.query(
      `UPDATE property_mapping_suggestions
       SET status = CASE WHEN property_name = $4 THEN 'approved' ELSE 'rejected' END,
           updated_at = NOW()
       WHERE workspace_id = $1 AND semantic_key = $2 AND object_type = $3`,
      [workspaceId, semanticKey, objectType, propertyName]
    );
    return { mapping, version: versionResult.rows[0], action };
  });
}

export function registerMappingWizardRoutes(app, {
  postgres,
  withTransaction,
  requireViewer,
  requireAdmin,
  writeAudit
}) {
  const basePath = '/api/v1/customer/workspaces/:workspaceId/mapping-wizard';

  app.get(basePath, { preHandler: requireViewer }, async (request) => ({
    workspaceId: request.params.workspaceId,
    role: request.workspaceMembership.role,
    ...(await loadMappingWizard(postgres, request.params.workspaceId))
  }));

  app.get(`${basePath}/:semanticKey/:objectType/history`, { preHandler: requireViewer }, async (request) => {
    const limit = Math.min(Math.max(Number(request.query?.limit ?? 30), 1), 100);
    const result = await postgres.query(
      `SELECT v.id, v.mapping_id, v.semantic_key, v.object_type, v.property_name,
              v.value_mapping, v.source, v.action, v.snapshot, v.created_at,
              u.display_name AS actor_name, u.email AS actor_email
       FROM property_mapping_versions v
       LEFT JOIN app_users u ON u.id = v.actor_user_id
       WHERE v.workspace_id = $1 AND v.semantic_key = $2 AND v.object_type = $3
       ORDER BY v.created_at DESC
       LIMIT $4`,
      [request.params.workspaceId, cleanToken(request.params.semanticKey, 100), cleanToken(request.params.objectType, 100), limit]
    );
    return { results: result.rows };
  });

  app.put(`${basePath}/:semanticKey/:objectType`, { preHandler: requireAdmin }, async (request) => {
    const semanticKey = cleanToken(request.params.semanticKey, 100);
    const objectType = cleanToken(request.params.objectType, 100);
    const propertyName = cleanToken(request.body?.propertyName, 160);
    if (!semanticKey || !objectType || !propertyName) throw mappingError('Semantic field, object type, and property are required.');

    const saved = await saveMapping({
      postgres,
      withTransaction,
      workspaceId: request.params.workspaceId,
      user: request.customer.user,
      semanticKey,
      objectType,
      propertyName,
      suppliedValueMapping: Object.hasOwn(request.body ?? {}, 'valueMapping') ? request.body.valueMapping : null
    });
    await writeAudit(request, {
      workspaceId: request.params.workspaceId,
      actorUserId: request.customer.user.id,
      action: `mapping.${saved.action}`,
      targetType: 'semantic_mapping',
      targetId: `${semanticKey}:${objectType}`,
      metadata: { propertyName, versionId: saved.version.id }
    });
    return saved;
  });

  app.post(`${basePath}/:semanticKey/:objectType/rollback/:versionId`, { preHandler: requireAdmin }, async (request) => {
    const semanticKey = cleanToken(request.params.semanticKey, 100);
    const objectType = cleanToken(request.params.objectType, 100);
    const versionId = cleanToken(request.params.versionId, 36);
    if (!UUID_PATTERN.test(versionId)) throw mappingError('Mapping version ID is invalid.');

    const versionResult = await postgres.query(
      `SELECT id, property_name, value_mapping
       FROM property_mapping_versions
       WHERE id = $1 AND workspace_id = $2 AND semantic_key = $3 AND object_type = $4
       LIMIT 1`,
      [versionId, request.params.workspaceId, semanticKey, objectType]
    );
    const version = versionResult.rows[0];
    if (!version || !version.property_name) {
      throw mappingError('Mapping version not found or cannot be restored.', 404, 'MAPPING_VERSION_NOT_FOUND');
    }

    const saved = await saveMapping({
      postgres,
      withTransaction,
      workspaceId: request.params.workspaceId,
      user: request.customer.user,
      semanticKey,
      objectType,
      propertyName: version.property_name,
      suppliedValueMapping: version.value_mapping,
      source: 'version_rollback',
      actionOverride: 'rolled_back',
      snapshot: { restoredVersionId: version.id }
    });
    await writeAudit(request, {
      workspaceId: request.params.workspaceId,
      actorUserId: request.customer.user.id,
      action: 'mapping.rolled_back',
      targetType: 'semantic_mapping',
      targetId: `${semanticKey}:${objectType}`,
      metadata: { restoredVersionId: version.id, propertyName: version.property_name, newVersionId: saved.version.id }
    });
    return saved;
  });

  app.delete(`${basePath}/:semanticKey/:objectType`, { preHandler: requireAdmin }, async (request, reply) => {
    const semanticKey = cleanToken(request.params.semanticKey, 100);
    const objectType = cleanToken(request.params.objectType, 100);
    const removed = await withTransaction(async (client) => {
      const current = await client.query(
        `DELETE FROM property_mappings
         WHERE workspace_id = $1 AND semantic_key = $2 AND object_type = $3
         RETURNING *`,
        [request.params.workspaceId, semanticKey, objectType]
      );
      if (current.rowCount === 0) return null;
      const mapping = current.rows[0];
      const version = await client.query(
        `INSERT INTO property_mapping_versions (
           workspace_id, mapping_id, semantic_key, object_type, property_name,
           value_mapping, source, action, actor_user_id, snapshot
         ) VALUES ($1, NULL, $2, $3, NULL, '{}'::jsonb, 'customer_removed', 'removed', $4, $5::jsonb)
         RETURNING id, created_at`,
        [request.params.workspaceId, semanticKey, objectType, request.customer.user.id, JSON.stringify({ previous: mapping })]
      );
      await client.query(
        `UPDATE property_mapping_suggestions
         SET status = 'suggested', updated_at = NOW()
         WHERE workspace_id = $1 AND semantic_key = $2 AND object_type = $3`,
        [request.params.workspaceId, semanticKey, objectType]
      );
      return { mapping, version: version.rows[0] };
    });
    if (!removed) return reply.code(404).send({ error: 'mapping_not_found', message: 'Mapping not found.' });
    await writeAudit(request, {
      workspaceId: request.params.workspaceId,
      actorUserId: request.customer.user.id,
      action: 'mapping.removed',
      targetType: 'semantic_mapping',
      targetId: `${semanticKey}:${objectType}`,
      metadata: { previousPropertyName: removed.mapping.property_name, versionId: removed.version.id }
    });
    return reply.code(204).send();
  });
}
