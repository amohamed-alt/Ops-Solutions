import { config } from './config.js';
import {
  getConnection,
  getValidAccessToken,
  hubSpotRequest,
  HubSpotWorkerError
} from './hubspot.js';

const ASSOCIATIONS = Object.freeze({
  contacts: ['companies', 'deals'],
  companies: ['contacts', 'deals'],
  deals: ['contacts', 'companies'],
  calls: ['contacts', 'companies', 'deals'],
  meetings: ['contacts', 'companies', 'deals'],
  tasks: ['contacts', 'companies', 'deals']
});

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

function parseTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function selectedProperties(postgres, workspaceId, objectType) {
  const [discoveredResult, mappedResult] = await Promise.all([
    postgres.query(
      `SELECT property_name FROM crm_properties
       WHERE workspace_id = $1 AND object_type = $2`,
      [workspaceId, objectType]
    ),
    postgres.query(
      `SELECT property_name FROM property_mappings
       WHERE workspace_id = $1 AND object_type = $2`,
      [workspaceId, objectType]
    )
  ]);
  const discovered = new Set(discoveredResult.rows.map((row) => row.property_name));
  const selected = new Set();
  for (const property of BASE_PROPERTY_CANDIDATES[objectType] ?? []) {
    if (discovered.has(property)) selected.add(property);
  }
  for (const row of mappedResult.rows) {
    if (discovered.has(row.property_name)) selected.add(row.property_name);
  }
  return [...selected].slice(0, 100);
}

async function replaceAssociations(client, workspaceId, objectType, record) {
  await client.query(
    `DELETE FROM crm_record_associations
     WHERE workspace_id = $1 AND from_object_type = $2 AND from_record_id = $3`,
    [workspaceId, objectType, String(record.id)]
  );

  for (const [toObjectType, group] of Object.entries(record.associations ?? {})) {
    for (const association of group?.results ?? []) {
      await client.query(
        `INSERT INTO crm_record_associations (
           workspace_id, from_object_type, from_record_id,
           to_object_type, to_record_id, association_type, synced_at
         ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (
           workspace_id, from_object_type, from_record_id,
           to_object_type, to_record_id, association_type
         ) DO UPDATE SET synced_at = NOW()`,
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

async function persistRecord(postgres, workspaceId, objectType, record, runId) {
  const client = await postgres.connect();
  try {
    await client.query('BEGIN');
    const updatedAt = parseTimestamp(
      record.updatedAt
      ?? record.properties?.hs_lastmodifieddate
      ?? record.properties?.lastmodifieddate
    );
    await client.query(
      `INSERT INTO crm_records (
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
         synced_at = NOW()`,
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
    await replaceAssociations(client, workspaceId, objectType, record);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function archiveRecord(postgres, workspaceId, objectType, objectId, metadata = {}) {
  const client = await postgres.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE crm_records
       SET archived = TRUE, synced_at = NOW(), raw = raw || $4::jsonb
       WHERE workspace_id = $1 AND object_type = $2 AND record_id = $3`,
      [workspaceId, objectType, objectId, JSON.stringify(metadata)]
    );
    await client.query(
      `DELETE FROM crm_record_associations
       WHERE workspace_id = $1
         AND ((from_object_type = $2 AND from_record_id = $3)
           OR (to_object_type = $2 AND to_record_id = $3))`,
      [workspaceId, objectType, objectId]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureTargetedWebhookSchema(postgres) {
  await postgres.query(`
    ALTER TABLE hubspot_webhook_events
      DROP CONSTRAINT IF EXISTS hubspot_webhook_events_status_check;
    ALTER TABLE hubspot_webhook_events
      ADD CONSTRAINT hubspot_webhook_events_status_check
      CHECK (status IN ('received', 'queued', 'processing', 'completed', 'ignored', 'failed'));
    CREATE INDEX IF NOT EXISTS hubspot_webhook_events_processing_idx
      ON hubspot_webhook_events(workspace_id, status, received_at)
      WHERE status IN ('queued', 'failed', 'processing');
  `);
}

export async function claimWebhookEvents(postgres, workspaceId, limit = 500) {
  const boundedLimit = Math.min(Math.max(Number(limit) || 1, 1), 500);
  const result = await postgres.query(
    `WITH candidates AS (
       SELECT id
       FROM hubspot_webhook_events
       WHERE workspace_id = $1 AND status IN ('queued', 'failed')
       ORDER BY received_at
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     UPDATE hubspot_webhook_events e
     SET status = 'processing', error = NULL, updated_at = NOW()
     FROM candidates
     WHERE e.id = candidates.id
     RETURNING e.id, e.object_type, e.object_id, e.action, e.occurred_at`,
    [workspaceId, boundedLimit]
  );
  return result.rows;
}

export async function syncWebhookEvents(postgres, workspaceId, { limit = 500 } = {}) {
  await ensureTargetedWebhookSchema(postgres);
  const events = await claimWebhookEvents(postgres, workspaceId, limit);
  if (events.length === 0) {
    return { status: 'noop', processed: 0, completed: 0, failed: 0 };
  }

  const connection = await getConnection(postgres, workspaceId);
  const accessToken = await getValidAccessToken(postgres, connection);
  const uniqueRecords = new Map();
  for (const event of events) {
    if (!event.object_type || !event.object_id) continue;
    const key = `${event.object_type}:${event.object_id}`;
    const current = uniqueRecords.get(key);
    if (!current || event.action === 'deleted') uniqueRecords.set(key, event);
  }

  const runResult = await postgres.query(
    `INSERT INTO sync_runs(workspace_id, mode, object_types)
     VALUES ($1, 'targeted', $2::jsonb)
     RETURNING id`,
    [workspaceId, JSON.stringify([...new Set(events.map((event) => event.object_type).filter(Boolean))])]
  );
  const runId = runResult.rows[0].id;
  const completedIds = [];
  const failedIds = [];
  const summary = { completed: [], failed: [] };

  try {
    for (const event of uniqueRecords.values()) {
      try {
        if (event.action === 'deleted') {
          await archiveRecord(postgres, workspaceId, event.object_type, event.object_id, {
            webhookDeletedAt: event.occurred_at
          });
          summary.completed.push({ objectType: event.object_type, objectId: event.object_id, action: 'archived' });
          continue;
        }

        const properties = await selectedProperties(postgres, workspaceId, event.object_type);
        const associations = ASSOCIATIONS[event.object_type] ?? [];
        const record = await hubSpotRequest(
          `/crm/v3/objects/${encodeURIComponent(event.object_type)}/${encodeURIComponent(event.object_id)}`,
          accessToken,
          {
            query: {
              archived: false,
              properties: properties.join(','),
              associations: associations.join(',')
            }
          }
        );
        await persistRecord(postgres, workspaceId, event.object_type, record, runId);
        summary.completed.push({ objectType: event.object_type, objectId: event.object_id, action: 'upserted' });
      } catch (error) {
        if (error instanceof HubSpotWorkerError && error.statusCode === 404) {
          await archiveRecord(postgres, workspaceId, event.object_type, event.object_id, {
            webhookNotFoundAt: new Date().toISOString()
          });
          summary.completed.push({ objectType: event.object_type, objectId: event.object_id, action: 'archived_not_found' });
          continue;
        }
        summary.failed.push({ objectType: event.object_type, objectId: event.object_id, reason: error.message });
      }
    }

    const failedKeys = new Set(summary.failed.map((item) => `${item.objectType}:${item.objectId}`));
    for (const event of events) {
      const key = `${event.object_type}:${event.object_id}`;
      (failedKeys.has(key) ? failedIds : completedIds).push(event.id);
    }

    if (completedIds.length > 0) {
      await postgres.query(
        `UPDATE hubspot_webhook_events
         SET status = 'completed', processed_at = NOW(), error = NULL, updated_at = NOW()
         WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
        [workspaceId, completedIds]
      );
    }
    if (failedIds.length > 0) {
      await postgres.query(
        `UPDATE hubspot_webhook_events
         SET status = 'failed', error = $3, updated_at = NOW()
         WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
        [workspaceId, failedIds, JSON.stringify(summary.failed).slice(0, 2000)]
      );
    }

    const status = failedIds.length > 0 ? 'partial' : 'completed';
    await postgres.query(
      `UPDATE sync_runs
       SET status = $2, summary = $3::jsonb, completed_at = NOW()
       WHERE id = $1`,
      [runId, status, JSON.stringify(summary)]
    );
    await postgres.query(
      `UPDATE hubspot_connections
       SET status = 'connected', last_error = NULL, updated_at = NOW()
       WHERE id = $1`,
      [connection.id]
    );

    if (failedIds.length > 0) {
      const error = new Error(`Targeted webhook sync failed for ${failedIds.length} event(s)`);
      error.summary = summary;
      throw error;
    }

    return {
      runId,
      status,
      processed: events.length,
      records: uniqueRecords.size,
      completed: completedIds.length,
      failed: failedIds.length,
      summary
    };
  } catch (error) {
    await postgres.query(
      `UPDATE hubspot_webhook_events
       SET status = 'failed', error = $3, updated_at = NOW()
       WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'processing'`,
      [workspaceId, events.map((event) => event.id), String(error.message).slice(0, 2000)]
    );
    await postgres.query(
      `UPDATE sync_runs
       SET status = 'failed', error = $2, summary = $3::jsonb, completed_at = NOW()
       WHERE id = $1 AND status = 'running'`,
      [runId, String(error.message).slice(0, 2000), JSON.stringify(summary)]
    );
    throw error;
  }
}
