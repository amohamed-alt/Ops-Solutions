import { postgres, withTransaction } from './database.js';
import { getConnectionForWorkspace, getValidAccessToken, hubSpotGet } from './hubspot.js';
import { buildMappingSuggestions } from './semantic.js';

const STANDARD_OBJECT_TYPES = ['contacts', 'companies', 'deals'];

async function fetchProperties(accessToken, objectType) {
  const payload = await hubSpotGet(`/crm/properties/2026-03/${encodeURIComponent(objectType)}`, accessToken);
  return (payload?.results ?? []).map((property) => ({
    object_type: objectType,
    property_name: property.name,
    label: property.label ?? property.name,
    description: property.description ?? '',
    group_name: property.groupName ?? null,
    field_type: property.fieldType ?? null,
    data_type: property.type ?? null,
    hubspot_defined: Boolean(property.hubspotDefined),
    options: property.options ?? [],
    raw: property
  }));
}

async function fetchOwners(accessToken) {
  const owners = [];
  let after;

  do {
    const payload = await hubSpotGet('/crm/owners/2026-03', accessToken, {
      limit: 100,
      archived: false,
      after
    });

    owners.push(...(payload?.results ?? []));
    after = payload?.paging?.next?.after;
  } while (after);

  return owners;
}

async function fetchPipelines(accessToken, objectType) {
  const payload = await hubSpotGet(
    `/crm/pipelines/2026-03/${encodeURIComponent(objectType)}`,
    accessToken,
    { archived: false }
  );

  return payload?.results ?? [];
}

async function fetchCustomSchemas(accessToken) {
  try {
    const payload = await hubSpotGet('/crm-object-schemas/2026-03/schemas', accessToken);
    return { schemas: payload?.results ?? [], warning: null };
  } catch (error) {
    if (error.statusCode === 403) {
      return {
        schemas: [],
        warning: 'Custom object schemas were skipped because this account or token does not grant crm.schemas.custom.read.'
      };
    }

    throw error;
  }
}

function customSchemaProperties(schema) {
  const objectType = schema.objectTypeId ?? schema.fullyQualifiedName ?? schema.name;
  return (schema.properties ?? []).map((property) => ({
    object_type: objectType,
    property_name: property.name,
    label: property.label ?? property.name,
    description: property.description ?? '',
    group_name: property.groupName ?? null,
    field_type: property.fieldType ?? null,
    data_type: property.type ?? null,
    hubspot_defined: Boolean(property.hubspotDefined),
    options: property.options ?? [],
    raw: property
  }));
}

async function persistDiscovery({
  workspaceId,
  connectionId,
  properties,
  owners,
  pipelinesByObject,
  summary,
  runId
}) {
  return withTransaction(async (client) => {
    await client.query('DELETE FROM crm_properties WHERE workspace_id = $1', [workspaceId]);
    await client.query('DELETE FROM crm_pipeline_stages WHERE workspace_id = $1', [workspaceId]);
    await client.query('DELETE FROM crm_pipelines WHERE workspace_id = $1', [workspaceId]);
    await client.query('DELETE FROM crm_owners WHERE workspace_id = $1', [workspaceId]);

    for (const property of properties) {
      await client.query(
        `
          INSERT INTO crm_properties (
            workspace_id, object_type, property_name, label, description,
            group_name, field_type, data_type, hubspot_defined, options, raw, discovered_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, NOW())
        `,
        [
          workspaceId,
          property.object_type,
          property.property_name,
          property.label,
          property.description,
          property.group_name,
          property.field_type,
          property.data_type,
          property.hubspot_defined,
          JSON.stringify(property.options),
          JSON.stringify(property.raw)
        ]
      );
    }

    for (const owner of owners) {
      await client.query(
        `
          INSERT INTO crm_owners (
            workspace_id, owner_id, user_id, email, first_name, last_name,
            archived, teams, raw, discovered_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, NOW())
        `,
        [
          workspaceId,
          owner.id,
          owner.userIdIncludingInactive ?? owner.userId ?? null,
          owner.email ?? null,
          owner.firstName ?? null,
          owner.lastName ?? null,
          Boolean(owner.archived),
          JSON.stringify(owner.teams ?? []),
          JSON.stringify(owner)
        ]
      );
    }

    for (const [objectType, pipelines] of Object.entries(pipelinesByObject)) {
      for (const pipeline of pipelines) {
        await client.query(
          `
            INSERT INTO crm_pipelines (
              workspace_id, object_type, pipeline_id, label,
              display_order, archived, raw, discovered_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
          `,
          [
            workspaceId,
            objectType,
            pipeline.id,
            pipeline.label ?? pipeline.id,
            pipeline.displayOrder ?? null,
            Boolean(pipeline.archived),
            JSON.stringify(pipeline)
          ]
        );

        for (const stage of pipeline.stages ?? []) {
          await client.query(
            `
              INSERT INTO crm_pipeline_stages (
                workspace_id, object_type, pipeline_id, stage_id, label,
                display_order, archived, metadata, raw, discovered_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, NOW())
            `,
            [
              workspaceId,
              objectType,
              pipeline.id,
              stage.id,
              stage.label ?? stage.id,
              stage.displayOrder ?? null,
              Boolean(stage.archived),
              JSON.stringify(stage.metadata ?? {}),
              JSON.stringify(stage)
            ]
          );
        }
      }
    }

    const semanticResult = await client.query('SELECT * FROM semantic_fields ORDER BY semantic_key');
    const suggestions = buildMappingSuggestions(semanticResult.rows, properties);

    await client.query(
      `DELETE FROM property_mapping_suggestions WHERE workspace_id = $1 AND status = 'suggested'`,
      [workspaceId]
    );

    for (const suggestion of suggestions) {
      await client.query(
        `
          INSERT INTO property_mapping_suggestions (
            workspace_id, semantic_key, object_type, property_name,
            confidence, reasons, status, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'suggested', NOW())
          ON CONFLICT (workspace_id, semantic_key, object_type, property_name)
          DO UPDATE SET
            confidence = EXCLUDED.confidence,
            reasons = EXCLUDED.reasons,
            status = CASE
              WHEN property_mapping_suggestions.status = 'approved' THEN 'approved'
              ELSE 'suggested'
            END,
            updated_at = NOW()
        `,
        [
          workspaceId,
          suggestion.semanticKey,
          suggestion.objectType,
          suggestion.propertyName,
          suggestion.confidence,
          JSON.stringify(suggestion.reasons)
        ]
      );
    }

    summary.mappingSuggestions = suggestions.length;

    await client.query(
      `
        UPDATE hubspot_connections
        SET last_discovered_at = NOW(), status = 'connected', last_error = NULL, updated_at = NOW()
        WHERE id = $1
      `,
      [connectionId]
    );

    await client.query(
      `
        UPDATE discovery_runs
        SET status = 'completed', summary = $2::jsonb, completed_at = NOW()
        WHERE id = $1
      `,
      [runId, JSON.stringify(summary)]
    );

    return summary;
  });
}

export async function discoverWorkspacePortal(workspaceId) {
  const connection = await getConnectionForWorkspace(workspaceId);
  if (!connection) {
    const error = new Error('No active HubSpot connection exists for this workspace');
    error.statusCode = 404;
    throw error;
  }

  const runResult = await postgres.query(
    `
      INSERT INTO discovery_runs(workspace_id, connection_id)
      VALUES ($1, $2)
      RETURNING id
    `,
    [workspaceId, connection.id]
  );
  const runId = runResult.rows[0].id;

  try {
    const accessToken = await getValidAccessToken(connection);
    const properties = [];
    const pipelinesByObject = {};
    const warnings = [];

    for (const objectType of STANDARD_OBJECT_TYPES) {
      properties.push(...await fetchProperties(accessToken, objectType));
    }

    const owners = await fetchOwners(accessToken);
    pipelinesByObject.deals = await fetchPipelines(accessToken, 'deals');

    const customResult = await fetchCustomSchemas(accessToken);
    if (customResult.warning) warnings.push(customResult.warning);

    for (const schema of customResult.schemas) {
      properties.push(...customSchemaProperties(schema));
      if (schema.metaType === 'PORTAL_SPECIFIC' && schema.objectTypeId) {
        try {
          pipelinesByObject[schema.objectTypeId] = await fetchPipelines(accessToken, schema.objectTypeId);
        } catch (error) {
          if (![403, 404].includes(error.statusCode)) throw error;
          warnings.push(`Pipelines were unavailable for custom object ${schema.objectTypeId}.`);
        }
      }
    }

    const summary = {
      portalId: Number(connection.portal_id),
      properties: properties.length,
      propertiesByObject: Object.fromEntries(
        [...new Set(properties.map((property) => property.object_type))]
          .map((objectType) => [
            objectType,
            properties.filter((property) => property.object_type === objectType).length
          ])
      ),
      owners: owners.length,
      pipelines: Object.values(pipelinesByObject).reduce((total, items) => total + items.length, 0),
      customObjects: customResult.schemas.length,
      warnings
    };

    return await persistDiscovery({
      workspaceId,
      connectionId: connection.id,
      properties,
      owners,
      pipelinesByObject,
      summary,
      runId
    });
  } catch (error) {
    await Promise.allSettled([
      postgres.query(
        `
          UPDATE discovery_runs
          SET status = 'failed', error = $2, completed_at = NOW()
          WHERE id = $1
        `,
        [runId, String(error.message ?? error).slice(0, 2000)]
      ),
      postgres.query(
        `
          UPDATE hubspot_connections
          SET status = 'error', last_error = $2, updated_at = NOW()
          WHERE id = $1
        `,
        [connection.id, String(error.message ?? error).slice(0, 2000)]
      )
    ]);

    throw error;
  }
}
