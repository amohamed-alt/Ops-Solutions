import { config } from './config.js';
import {
  getConnection,
  getValidAccessToken,
  hubSpotRequest,
  HubSpotWorkerError
} from './hubspot.js';

const BASE_PROPERTY_CANDIDATES = Object.freeze({
  contacts: [
    'firstname', 'lastname', 'email', 'phone', 'mobilephone', 'company', 'jobtitle',
    'city', 'state', 'country', 'lifecyclestage', 'hs_lead_status', 'hubspot_owner_id',
    'createdate', 'lastmodifieddate', 'hs_lastmodifieddate', 'notes_last_contacted',
    'notes_last_updated', 'hs_next_activity_date'
  ],
  companies: [
    'name', 'domain', 'phone', 'city', 'state', 'country', 'industry', 'numberofemployees',
    'annualrevenue', 'lifecyclestage', 'hubspot_owner_id', 'createdate', 'hs_lastmodifieddate',
    'notes_last_contacted', 'hs_next_activity_date'
  ],
  deals: [
    'dealname', 'amount', 'dealstage', 'pipeline', 'closedate', 'createdate',
    'hs_lastmodifieddate', 'hubspot_owner_id', 'hs_last_activity_date',
    'hs_next_activity_date', 'hs_next_step', 'hs_is_closed', 'hs_is_closed_won'
  ],
  calls: [
    'hs_call_title', 'hs_call_body', 'hs_call_status', 'hs_call_disposition', 'hs_timestamp',
    'hs_call_duration', 'hubspot_owner_id', 'hs_lastmodifieddate'
  ],
  meetings: [
    'hs_meeting_title', 'hs_meeting_body', 'hs_meeting_outcome', 'hs_timestamp',
    'hs_meeting_start_time', 'hs_meeting_end_time', 'hubspot_owner_id', 'hs_lastmodifieddate'
  ],
  tasks: [
    'hs_task_subject', 'hs_task_body', 'hs_task_status', 'hs_task_type', 'hs_task_priority',
    'hs_timestamp', 'hubspot_owner_id', 'hs_lastmodifieddate'
  ]
});

const ASSOCIATIONS = Object.freeze({
  contacts: ['companies', 'deals'],
  companies: ['contacts', 'deals'],
  deals: ['contacts', 'companies'],
  calls: ['contacts', 'companies', 'deals'],
  meetings: ['contacts', 'companies', 'deals'],
  tasks: ['contacts', 'companies', 'deals']
});

export async function ensureSyncSchema(postgres) {
  await postgres.query(`
    CREATE TABLE IF NOT EXISTS sync_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      mode TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      object_types JSONB NOT NULL DEFAULT '[]'::jsonb,
      summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      error TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS sync_cursors (
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      object_type TEXT NOT NULL,
      last_modified_at TIMESTAMPTZ,
      last_success_at TIMESTAMPTZ,
      last_full_sync_at TIMESTAMPTZ,
      last_incremental_sync_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, object_type)
    );

    CREATE TABLE IF NOT EXISTS crm_records (
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      object_type TEXT NOT NULL,
      record_id TEXT NOT NULL,
      properties JSONB NOT NULL DEFAULT '{}'::jsonb,
      archived BOOLEAN NOT NULL DEFAULT FALSE,
      hubspot_created_at TIMESTAMPTZ,
      hubspot_updated_at TIMESTAMPTZ,
      raw JSONB NOT NULL,
      last_seen_run_id UUID REFERENCES sync_runs(id) ON DELETE SET NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, object_type, record_id)
    );

    CREATE TABLE IF NOT EXISTS crm_record_associations (
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      from_object_type TEXT NOT NULL,
      from_record_id TEXT NOT NULL,
      to_object_type TEXT NOT NULL,
      to_record_id TEXT NOT NULL,
      association_type TEXT NOT NULL DEFAULT '',
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (
        workspace_id,
        from_object_type,
        from_record_id,
        to_object_type,
        to_record_id,
        association_type
      )
    );

    CREATE INDEX IF NOT EXISTS sync_runs_workspace_started_idx
      ON sync_runs(workspace_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS crm_records_workspace_object_updated_idx
      ON crm_records(workspace_id, object_type, hubspot_updated_at DESC);
    CREATE INDEX IF NOT EXISTS crm_records_properties_gin_idx
      ON crm_records USING GIN(properties);
    CREATE INDEX IF NOT EXISTS crm_associations_from_idx
      ON crm_record_associations(workspace_id, from_object_type, from_record_id);
    CREATE INDEX IF NOT EXISTS crm_associations_to_idx
      ON crm_record_associations(workspace_id, to_object_type, to_record_id);
  `);
}

async function selectedProperties(postgres, workspaceId, objectType) {
  const discoveredResult = await postgres.query(
    `
      SELECT property_name
      FROM crm_properties
      WHERE workspace_id = $1 AND object_type = $2
    `,
    [workspaceId, objectType]
  );
  const discovered = new Set(discoveredResult.rows.map((row) => row.property_name));

  const mappedResult = await postgres.query(
    `
      SELECT property_name
      FROM property_mappings
      WHERE workspace_id = $1 AND object_type = $2
    `,
    [workspaceId, objectType]
  );

  const selected = new Set();
  for (const property of BASE_PROPERTY_CANDIDATES[objectType] ?? []) {
    if (discovered.has(property)) selected.add(property);
  }
  for (const row of mappedResult.rows) {
    if (discovered.has(row.property_name)) selected.add(row.property_name);
  }

  return [...selected].slice(0, 100);
}

function parseTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function recordUpdatedAt(record) {
  return parseTimestamp(
    record.updatedAt
      ?? record.properties?.hs_lastmodifieddate
      ?? record.properties?.lastmodifieddate
  );
}

async function replaceAssociations(client, workspaceId, objectType, record) {
  await client.query(
    `
      DELETE FROM crm_record_associations
      WHERE workspace_id = $1
        AND from_object_type = $2
        AND from_record_id = $3
    `,
    [workspaceId, objectType, String(record.id)]
  );

  for (const [toObjectType, group] of Object.entries(record.associations ?? {})) {
    for (const association of group?.results ?? []) {
      await client.query(
        `
          INSERT INTO crm_record_associations (
            workspace_id, from_object_type, from_record_id,
            to_object_type, to_record_id, association_type, synced_at
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
          ON CONFLICT DO UPDATE SET synced_at = NOW()
        `,
        [
          workspaceId,
          objectType,
          String(record.id),
          toObjectType,
          String(association.id),
          String(association.type ?? '')
        ]
      );
    }
  }
}

async function persistPage(postgres, workspaceId, objectType, records, runId, includeAssociations) {
  const client = await postgres.connect();
  let newestUpdatedAt = null;

  try {
    await client.query('BEGIN');

    for (const record of records) {
      const updatedAt = recordUpdatedAt(record);
      if (updatedAt && (!newestUpdatedAt || updatedAt > newestUpdatedAt)) {
        newestUpdatedAt = updatedAt;
      }

      await client.query(
        `
          INSERT INTO crm_records (
            workspace_id, object_type, record_id, properties, archived,
            hubspot_created_at, hubspot_updated_at, raw, last_seen_run_id, synced_at
          ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9, NOW())
          ON CONFLICT (workspace_id, object_type, record_id)
          DO UPDATE SET
            properties = EXCLUDED.properties,
            archived = EXCLUDED.archived,
            hubspot_created_at = EXCLUDED.hubspot_created_at,
            hubspot_updated_at = EXCLUDED.hubspot_updated_at,
            raw = EXCLUDED.raw,
            last_seen_run_id = EXCLUDED.last_seen_run_id,
            synced_at = NOW()
        `,
        [
          workspaceId,
          objectType,
          String(record.id),
          JSON.stringify(record.properties ?? {}),
          Boolean(record.archived),
          parseTimestamp(record.createdAt),
          updatedAt,
          JSON.stringify(record),
          runId
        ]
      );

      if (includeAssociations) {
        await replaceAssociations(client, workspaceId, objectType, record);
      }
    }

    await client.query('COMMIT');
    return newestUpdatedAt;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function fullObjectSync({ postgres, workspaceId, objectType, accessToken, runId }) {
  const properties = await selectedProperties(postgres, workspaceId, objectType);
  const associations = ASSOCIATIONS[objectType] ?? [];
  let after;
  let pageCount = 0;
  let recordCount = 0;
  let newestUpdatedAt = null;

  do {
    const payload = await hubSpotRequest(`/crm/v3/objects/${objectType}`, accessToken, {
      query: {
        limit: config.hubspot.pageSize,
        after,
        archived: false,
        properties: properties.join(','),
        associations: associations.join(',')
      }
    });

    const records = payload?.results ?? [];
    const pageNewest = await persistPage(
      postgres,
      workspaceId,
      objectType,
      records,
      runId,
      true
    );

    if (pageNewest && (!newestUpdatedAt || pageNewest > newestUpdatedAt)) {
      newestUpdatedAt = pageNewest;
    }

    recordCount += records.length;
    pageCount += 1;
    after = payload?.paging?.next?.after;

    if (pageCount >= config.sync.maxPagesPerRun && after) {
      throw new Error(`Full sync page limit reached for ${objectType}`);
    }
  } while (after);

  return { objectType, mode: 'full', recordCount, pageCount, newestUpdatedAt };
}

async function incrementalObjectSync({ postgres, workspaceId, objectType, accessToken, runId, since }) {
  const properties = await selectedProperties(postgres, workspaceId, objectType);
  let after;
  let pageCount = 0;
  let recordCount = 0;
  let newestUpdatedAt = since;

  do {
    const payload = await hubSpotRequest(`/crm/v3/objects/${objectType}/search`, accessToken, {
      method: 'POST',
      body: {
        filterGroups: [{
          filters: [{
            propertyName: 'hs_lastmodifieddate',
            operator: 'GTE',
            value: String(since.getTime())
          }]
        }],
        sorts: ['hs_lastmodifieddate'],
        properties,
        limit: config.hubspot.pageSize,
        ...(after ? { after } : {})
      }
    });

    const records = payload?.results ?? [];
    const pageNewest = await persistPage(
      postgres,
      workspaceId,
      objectType,
      records,
      runId,
      false
    );

    if (pageNewest && pageNewest > newestUpdatedAt) newestUpdatedAt = pageNewest;

    recordCount += records.length;
    pageCount += 1;
    after = payload?.paging?.next?.after;

    if (pageCount >= 100 && after) {
      throw new Error(`Incremental search result limit approached for ${objectType}; full reconciliation required`);
    }
  } while (after);

  return { objectType, mode: 'incremental', recordCount, pageCount, newestUpdatedAt };
}

async function cursorFor(postgres, workspaceId, objectType) {
  const result = await postgres.query(
    `
      SELECT * FROM sync_cursors
      WHERE workspace_id = $1 AND object_type = $2
    `,
    [workspaceId, objectType]
  );
  return result.rows[0] ?? null;
}

async function updateCursor(postgres, workspaceId, objectType, mode, newestUpdatedAt) {
  await postgres.query(
    `
      INSERT INTO sync_cursors (
        workspace_id, object_type, last_modified_at, last_success_at,
        last_full_sync_at, last_incremental_sync_at, updated_at
      ) VALUES (
        $1, $2, $3, NOW(),
        CASE WHEN $4 = 'full' THEN NOW() ELSE NULL END,
        CASE WHEN $4 = 'incremental' THEN NOW() ELSE NULL END,
        NOW()
      )
      ON CONFLICT (workspace_id, object_type)
      DO UPDATE SET
        last_modified_at = COALESCE(EXCLUDED.last_modified_at, sync_cursors.last_modified_at),
        last_success_at = NOW(),
        last_full_sync_at = CASE
          WHEN $4 = 'full' THEN NOW()
          ELSE sync_cursors.last_full_sync_at
        END,
        last_incremental_sync_at = CASE
          WHEN $4 = 'incremental' THEN NOW()
          ELSE sync_cursors.last_incremental_sync_at
        END,
        updated_at = NOW()
    `,
    [workspaceId, objectType, newestUpdatedAt, mode]
  );
}

function canSkipScopeError(error) {
  return error instanceof HubSpotWorkerError
    && [401, 403, 404].includes(error.statusCode);
}

export async function syncWorkspace(postgres, workspaceId, requestedMode = 'auto') {
  await ensureSyncSchema(postgres);

  const connection = await getConnection(postgres, workspaceId);
  const accessToken = await getValidAccessToken(postgres, connection);
  const runResult = await postgres.query(
    `
      INSERT INTO sync_runs(workspace_id, mode, object_types)
      VALUES ($1, $2, $3::jsonb)
      RETURNING id
    `,
    [workspaceId, requestedMode, JSON.stringify(config.hubspot.objectTypes)]
  );
  const runId = runResult.rows[0].id;
  const summary = { completed: [], skipped: [], failed: [] };

  try {
    for (const objectType of config.hubspot.objectTypes) {
      const cursor = await cursorFor(postgres, workspaceId, objectType);
      const fullDueAt = cursor?.last_full_sync_at
        ? new Date(cursor.last_full_sync_at).getTime() + config.sync.fullReconciliationHours * 3_600_000
        : 0;
      const shouldFullSync = requestedMode === 'initial'
        || requestedMode === 'full'
        || !cursor?.last_success_at
        || Date.now() >= fullDueAt;

      try {
        let result;
        if (shouldFullSync) {
          result = await fullObjectSync({ postgres, workspaceId, objectType, accessToken, runId });
        } else {
          const lastModified = cursor?.last_modified_at
            ? new Date(cursor.last_modified_at)
            : new Date(Date.now() - 24 * 3_600_000);
          const overlapSince = new Date(lastModified.getTime() - 5 * 60_000);
          result = await incrementalObjectSync({
            postgres,
            workspaceId,
            objectType,
            accessToken,
            runId,
            since: overlapSince
          });
        }

        await updateCursor(
          postgres,
          workspaceId,
          objectType,
          result.mode,
          result.newestUpdatedAt
        );
        summary.completed.push({
          objectType,
          mode: result.mode,
          records: result.recordCount,
          pages: result.pageCount
        });
      } catch (error) {
        if (canSkipScopeError(error)) {
          summary.skipped.push({ objectType, reason: error.message, statusCode: error.statusCode });
          continue;
        }

        summary.failed.push({ objectType, reason: error.message });
      }
    }

    const status = summary.failed.length > 0 ? 'partial' : 'completed';
    await postgres.query(
      `
        UPDATE sync_runs
        SET status = $2, summary = $3::jsonb, completed_at = NOW()
        WHERE id = $1
      `,
      [runId, status, JSON.stringify(summary)]
    );

    await postgres.query(
      `
        UPDATE hubspot_connections
        SET status = 'connected', last_error = NULL, updated_at = NOW()
        WHERE id = $1
      `,
      [connection.id]
    );

    if (summary.failed.length > 0) {
      const error = new Error(`CRM sync completed partially: ${summary.failed.length} object type(s) failed`);
      error.summary = summary;
      throw error;
    }

    return { runId, status, summary };
  } catch (error) {
    await postgres.query(
      `
        UPDATE sync_runs
        SET status = 'failed', error = $2, summary = $3::jsonb, completed_at = NOW()
        WHERE id = $1 AND status = 'running'
      `,
      [runId, error.message, JSON.stringify(summary)]
    );

    await postgres.query(
      `
        UPDATE hubspot_connections
        SET last_error = $2, updated_at = NOW()
        WHERE id = $1
      `,
      [connection.id, error.message]
    );

    throw error;
  }
}

export async function workspacesDueForSync(postgres) {
  await ensureSyncSchema(postgres);

  const result = await postgres.query(
    `
      SELECT
        c.workspace_id,
        MAX(s.last_success_at) AS last_success_at
      FROM hubspot_connections c
      LEFT JOIN sync_cursors s ON s.workspace_id = c.workspace_id
      WHERE c.status = 'connected'
      GROUP BY c.workspace_id
      HAVING MAX(s.last_success_at) IS NULL
         OR MAX(s.last_success_at) < NOW() - ($1::int * INTERVAL '1 minute')
      ORDER BY MAX(s.last_success_at) NULLS FIRST
      LIMIT 50
    `,
    [config.sync.incrementalIntervalMinutes]
  );

  return result.rows;
}
