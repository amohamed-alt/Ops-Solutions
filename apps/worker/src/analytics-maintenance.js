const INDEX_DEFINITIONS = Object.freeze([
  {
    name: 'crm_records_active_object_created_idx',
    sql: `CREATE INDEX IF NOT EXISTS crm_records_active_object_created_idx
      ON crm_records(workspace_id, object_type, hubspot_created_at DESC)
      WHERE archived = FALSE`
  },
  {
    name: 'crm_records_active_object_synced_idx',
    sql: `CREATE INDEX IF NOT EXISTS crm_records_active_object_synced_idx
      ON crm_records(workspace_id, object_type, synced_at DESC)
      WHERE archived = FALSE`
  },
  {
    name: 'crm_records_owner_active_idx',
    sql: `CREATE INDEX IF NOT EXISTS crm_records_owner_active_idx
      ON crm_records(workspace_id, object_type, (properties->>'hubspot_owner_id'))
      WHERE archived = FALSE`
  },
  {
    name: 'crm_contacts_country_active_idx',
    sql: `CREATE INDEX IF NOT EXISTS crm_contacts_country_active_idx
      ON crm_records(workspace_id, (COALESCE(NULLIF(properties->>'country', ''), NULLIF(properties->>'hs_country_region_code', ''))))
      WHERE object_type = 'contacts' AND archived = FALSE`
  },
  {
    name: 'crm_contacts_source_active_idx',
    sql: `CREATE INDEX IF NOT EXISTS crm_contacts_source_active_idx
      ON crm_records(workspace_id, (COALESCE(NULLIF(properties->>'hs_analytics_source', ''), NULLIF(properties->>'lead_source', ''), NULLIF(properties->>'original_source', ''))))
      WHERE object_type = 'contacts' AND archived = FALSE`
  },
  {
    name: 'crm_deals_pipeline_stage_active_idx',
    sql: `CREATE INDEX IF NOT EXISTS crm_deals_pipeline_stage_active_idx
      ON crm_records(workspace_id, (properties->>'pipeline'), (properties->>'dealstage'))
      WHERE object_type = 'deals' AND archived = FALSE`
  },
  {
    name: 'crm_deals_close_date_active_idx',
    sql: `CREATE INDEX IF NOT EXISTS crm_deals_close_date_active_idx
      ON crm_records(workspace_id, (properties->>'closedate'))
      WHERE object_type = 'deals' AND archived = FALSE`
  },
  {
    name: 'crm_activities_timestamp_active_idx',
    sql: `CREATE INDEX IF NOT EXISTS crm_activities_timestamp_active_idx
      ON crm_records(workspace_id, object_type, (properties->>'hs_timestamp'))
      WHERE object_type IN ('calls', 'meetings', 'tasks') AND archived = FALSE`
  },
  {
    name: 'crm_associations_reverse_cover_idx',
    sql: `CREATE INDEX IF NOT EXISTS crm_associations_reverse_cover_idx
      ON crm_record_associations(workspace_id, to_object_type, to_record_id, from_object_type, from_record_id)`
  }
]);

export function analyticsIndexDefinitions() {
  return INDEX_DEFINITIONS.map((definition) => ({ ...definition }));
}

export async function ensureAnalyticsIndexes(postgres, { log = () => undefined } = {}) {
  const startedAt = Date.now();
  let created = 0;

  for (const definition of INDEX_DEFINITIONS) {
    const indexStartedAt = Date.now();
    await postgres.query(definition.sql);
    created += 1;
    log('info', 'analytics_index_ready', {
      index: definition.name,
      durationMs: Date.now() - indexStartedAt
    });
  }

  return {
    indexes: created,
    durationMs: Date.now() - startedAt
  };
}

export async function runPlannerMaintenance(postgres, redis, {
  now = Date.now(),
  intervalSeconds = 6 * 60 * 60,
  log = () => undefined
} = {}) {
  const bucket = Math.floor(now / (intervalSeconds * 1000));
  const key = `ops-solutions:analytics-maintenance:${bucket}`;
  const acquired = await redis.set(key, String(now), 'EX', intervalSeconds * 2, 'NX');

  if (acquired !== 'OK') {
    return { executed: false, reason: 'already_completed_for_interval' };
  }

  const startedAt = Date.now();
  try {
    await postgres.query('ANALYZE crm_records');
    await postgres.query('ANALYZE crm_record_associations');
    await postgres.query('ANALYZE sync_runs');
    const result = {
      executed: true,
      durationMs: Date.now() - startedAt,
      tables: ['crm_records', 'crm_record_associations', 'sync_runs']
    };
    log('info', 'analytics_planner_maintenance_completed', result);
    return result;
  } catch (error) {
    await redis.del(key);
    throw error;
  }
}
