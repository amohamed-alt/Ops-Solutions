import {
  AnalyticsDefinitionError,
  compileDrilldownQuery,
  compileMetricQuery,
  indexTemplate
} from './analytics.js';
import { sdrDashboardTemplate } from './templates/sdr-dashboard.js';

const indexedTemplate = indexTemplate(sdrDashboardTemplate);

function numericValue(value) {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function serializeMetricRows(rows, grouped = false) {
  if (!grouped) return numericValue(rows?.[0]?.value);
  return (rows ?? []).map((row) => ({
    key: row.group_key || 'Unassigned',
    value: numericValue(row.value)
  }));
}

async function loadMappings(postgres, workspaceId, objectType) {
  const result = await postgres.query(
    `SELECT semantic_key, property_name, value_mapping
     FROM property_mappings
     WHERE workspace_id = $1 AND object_type = $2`,
    [workspaceId, objectType]
  );

  return Object.fromEntries(result.rows.map((row) => [row.semantic_key, {
    propertyName: row.property_name,
    valueMapping: row.value_mapping ?? {}
  }]));
}

async function mappingReadiness(postgres, workspaceId) {
  const result = await postgres.query(
    `SELECT semantic_key, object_type, property_name, value_mapping
     FROM property_mappings
     WHERE workspace_id = $1
     ORDER BY semantic_key, object_type`,
    [workspaceId]
  );

  const approved = result.rows.map((row) => ({
    semanticKey: row.semantic_key,
    objectType: row.object_type,
    propertyName: row.property_name,
    valueMapping: row.value_mapping ?? {}
  }));
  const approvedKeys = new Set(approved.map((row) => row.semanticKey));

  return {
    approved,
    required: sdrDashboardTemplate.requiredSemanticFields.map((key) => ({
      key,
      approved: approvedKeys.has(key)
    })),
    optional: sdrDashboardTemplate.optionalSemanticFields.map((key) => ({
      key,
      approved: approvedKeys.has(key)
    }))
  };
}

async function executeMetric(postgres, workspaceId, definition) {
  const mappings = await loadMappings(postgres, workspaceId, definition.objectType);
  const query = compileMetricQuery({
    workspaceId,
    definition,
    mappings,
    virtualProperties: indexedTemplate.virtualProperties
  });
  const result = await postgres.query(query.text, query.values);

  return serializeMetricRows(result.rows, Boolean(definition.groupBy));
}

function metricPublicDefinition(metric) {
  return {
    key: metric.key,
    label: metric.label,
    objectType: metric.objectType,
    aggregation: metric.aggregation,
    field: metric.field ?? null,
    groupBy: metric.groupBy ?? null
  };
}

async function executeMetricSafely(postgres, workspaceId, definition) {
  try {
    return {
      ...metricPublicDefinition(definition),
      status: 'ready',
      value: await executeMetric(postgres, workspaceId, definition),
      error: null
    };
  } catch (error) {
    if (!(error instanceof AnalyticsDefinitionError)) throw error;
    return {
      ...metricPublicDefinition(definition),
      status: 'configuration_required',
      value: null,
      error: error.message
    };
  }
}

async function syncFreshness(postgres, workspaceId) {
  const result = await postgres.query(
    `SELECT
       COUNT(*)::bigint AS total_records,
       MAX(synced_at) AS latest_sync,
       MIN(synced_at) AS oldest_sync
     FROM crm_records
     WHERE workspace_id = $1 AND archived = FALSE`,
    [workspaceId]
  );
  const row = result.rows[0] ?? {};
  return {
    totalRecords: numericValue(row.total_records),
    latestSync: row.latest_sync ?? null,
    oldestSync: row.oldest_sync ?? null
  };
}

async function ownersIndex(postgres, workspaceId) {
  const result = await postgres.query(
    `SELECT owner_id, email, first_name, last_name, archived
     FROM crm_owners
     WHERE workspace_id = $1`,
    [workspaceId]
  );
  return Object.fromEntries(result.rows.map((row) => [String(row.owner_id), {
    id: String(row.owner_id),
    name: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email || `Owner ${row.owner_id}`,
    email: row.email ?? null,
    archived: Boolean(row.archived)
  }]));
}

export async function buildSdrDashboard(postgres, workspaceId) {
  const metricResults = await Promise.all(
    sdrDashboardTemplate.metrics.map((metric) => executeMetricSafely(postgres, workspaceId, metric))
  );

  const activityByOwnerDefinition = {
    key: 'activity_by_owner',
    label: 'Calls by Owner',
    objectType: 'calls',
    aggregation: 'count',
    groupBy: 'hubspot_owner_id'
  };
  const [activityByOwner, mappings, freshness, owners] = await Promise.all([
    executeMetricSafely(postgres, workspaceId, activityByOwnerDefinition),
    mappingReadiness(postgres, workspaceId),
    syncFreshness(postgres, workspaceId),
    ownersIndex(postgres, workspaceId)
  ]);

  if (Array.isArray(activityByOwner.value)) {
    activityByOwner.value = activityByOwner.value.map((item) => ({
      ...item,
      owner: owners[item.key] ?? {
        id: item.key,
        name: item.key === 'Unassigned' ? 'Unassigned' : `Owner ${item.key}`,
        email: null,
        archived: false
      }
    }));
  }

  return {
    template: {
      key: sdrDashboardTemplate.key,
      name: sdrDashboardTemplate.name,
      version: sdrDashboardTemplate.version,
      description: sdrDashboardTemplate.description
    },
    generatedAt: new Date().toISOString(),
    freshness,
    mappingReadiness: mappings,
    metrics: Object.fromEntries(metricResults.map((metric) => [metric.key, metric])),
    leaderboards: {
      activityByOwner
    },
    drilldowns: [
      {
        key: 'priority-leads-needing-action',
        label: 'Priority Leads Needing Action',
        objectType: 'contacts',
        columns: ['firstname', 'lastname', 'email', 'phone', 'hubspot_owner_id', 'notes_last_contacted']
      }
    ]
  };
}

export async function getSdrMetric(postgres, workspaceId, metricKey) {
  const definition = indexedTemplate.metrics[metricKey];
  if (!definition) {
    const error = new Error(`Unknown SDR metric: ${metricKey}`);
    error.statusCode = 404;
    error.category = 'METRIC_NOT_FOUND';
    throw error;
  }
  return executeMetricSafely(postgres, workspaceId, definition);
}

export async function getPriorityLeadDrilldown(postgres, workspaceId, { limit, offset } = {}) {
  const widget = sdrDashboardTemplate.widgets.find((item) => item.type === 'table');
  const mappings = await loadMappings(postgres, workspaceId, widget.objectType);
  const query = compileDrilldownQuery({
    workspaceId,
    objectType: widget.objectType,
    filters: widget.filters,
    mappings,
    virtualProperties: indexedTemplate.virtualProperties,
    limit,
    offset
  });
  const result = await postgres.query(query.text, query.values);

  return {
    key: 'priority-leads-needing-action',
    objectType: widget.objectType,
    columns: widget.columns,
    limit: query.limit,
    offset: query.offset,
    results: result.rows.map((row) => ({
      id: row.record_id,
      properties: row.properties ?? {},
      hubspotCreatedAt: row.hubspot_created_at,
      hubspotUpdatedAt: row.hubspot_updated_at,
      syncedAt: row.synced_at
    }))
  };
}

export function registerAnalyticsRoutes(app, { postgres, requireAdmin, requireWorkspace }) {
  app.get('/api/v1/workspaces/:workspaceId/analytics/sdr', { preHandler: requireAdmin }, async (request) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    return {
      workspace,
      dashboard: await buildSdrDashboard(postgres, workspace.id)
    };
  });

  app.get('/api/v1/workspaces/:workspaceId/analytics/sdr/metrics/:metricKey', { preHandler: requireAdmin }, async (request) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    return {
      workspaceId: workspace.id,
      metric: await getSdrMetric(postgres, workspace.id, String(request.params.metricKey ?? ''))
    };
  });

  app.get('/api/v1/workspaces/:workspaceId/analytics/sdr/drilldowns/priority-leads-needing-action', { preHandler: requireAdmin }, async (request) => {
    const workspace = await requireWorkspace(request.params.workspaceId);
    return {
      workspaceId: workspace.id,
      drilldown: await getPriorityLeadDrilldown(postgres, workspace.id, {
        limit: request.query?.limit,
        offset: request.query?.offset
      })
    };
  });
}
