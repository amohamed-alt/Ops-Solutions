import pg from 'pg';

import { config } from './config.js';

const { Pool } = pg;

export const postgres = new Pool({
  connectionString: config.databaseUrl,
  max: 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

const migrations = [
  {
    version: 1,
    name: 'workspace_and_hubspot_foundation',
    sql: `
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      CREATE TABLE IF NOT EXISTS workspaces (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS hubspot_connections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
        portal_id BIGINT NOT NULL UNIQUE,
        access_token_encrypted TEXT NOT NULL,
        refresh_token_encrypted TEXT NOT NULL,
        token_expires_at TIMESTAMPTZ NOT NULL,
        scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
        status TEXT NOT NULL DEFAULT 'connected',
        last_error TEXT,
        connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_discovered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS oauth_states (
        state_hash CHAR(64) PRIMARY KEY,
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS crm_properties (
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        object_type TEXT NOT NULL,
        property_name TEXT NOT NULL,
        label TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        group_name TEXT,
        field_type TEXT,
        data_type TEXT,
        hubspot_defined BOOLEAN NOT NULL DEFAULT FALSE,
        options JSONB NOT NULL DEFAULT '[]'::jsonb,
        raw JSONB NOT NULL,
        discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (workspace_id, object_type, property_name)
      );

      CREATE TABLE IF NOT EXISTS crm_pipelines (
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        object_type TEXT NOT NULL,
        pipeline_id TEXT NOT NULL,
        label TEXT NOT NULL,
        display_order INTEGER,
        archived BOOLEAN NOT NULL DEFAULT FALSE,
        raw JSONB NOT NULL,
        discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (workspace_id, object_type, pipeline_id)
      );

      CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        object_type TEXT NOT NULL,
        pipeline_id TEXT NOT NULL,
        stage_id TEXT NOT NULL,
        label TEXT NOT NULL,
        display_order INTEGER,
        archived BOOLEAN NOT NULL DEFAULT FALSE,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        raw JSONB NOT NULL,
        discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (workspace_id, object_type, pipeline_id, stage_id)
      );

      CREATE TABLE IF NOT EXISTS crm_owners (
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL,
        user_id BIGINT,
        email TEXT,
        first_name TEXT,
        last_name TEXT,
        archived BOOLEAN NOT NULL DEFAULT FALSE,
        teams JSONB NOT NULL DEFAULT '[]'::jsonb,
        raw JSONB NOT NULL,
        discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (workspace_id, owner_id)
      );

      CREATE TABLE IF NOT EXISTS semantic_fields (
        semantic_key TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        description TEXT NOT NULL,
        object_types JSONB NOT NULL,
        expected_types JSONB NOT NULL,
        keyword_hints JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS property_mapping_suggestions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        semantic_key TEXT NOT NULL REFERENCES semantic_fields(semantic_key) ON DELETE CASCADE,
        object_type TEXT NOT NULL,
        property_name TEXT NOT NULL,
        confidence NUMERIC(5,4) NOT NULL,
        reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
        status TEXT NOT NULL DEFAULT 'suggested',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (workspace_id, semantic_key, object_type, property_name)
      );

      CREATE TABLE IF NOT EXISTS property_mappings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        semantic_key TEXT NOT NULL REFERENCES semantic_fields(semantic_key) ON DELETE CASCADE,
        object_type TEXT NOT NULL,
        property_name TEXT NOT NULL,
        value_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
        source TEXT NOT NULL DEFAULT 'manual',
        approved_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (workspace_id, semantic_key, object_type)
      );

      CREATE TABLE IF NOT EXISTS discovery_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        connection_id UUID NOT NULL REFERENCES hubspot_connections(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'running',
        summary JSONB NOT NULL DEFAULT '{}'::jsonb,
        error TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS crm_properties_workspace_object_idx
        ON crm_properties(workspace_id, object_type);
      CREATE INDEX IF NOT EXISTS mapping_suggestions_workspace_idx
        ON property_mapping_suggestions(workspace_id, semantic_key, confidence DESC);
      CREATE INDEX IF NOT EXISTS discovery_runs_workspace_idx
        ON discovery_runs(workspace_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS oauth_states_expiry_idx
        ON oauth_states(expires_at);
    `
  }
];

const semanticFields = [
  {
    key: 'lead_quality',
    label: 'Lead Quality',
    description: 'Lead rank, tier, grade, or sales priority.',
    objectTypes: ['contacts', 'companies'],
    expectedTypes: ['enumeration', 'string', 'number'],
    keywords: ['lead rank', 'rank', 'lead tier', 'tier', 'lead grade', 'prospect grade', 'priority', 'lead quality', 'hot warm cold']
  },
  {
    key: 'lead_source',
    label: 'Lead Source',
    description: 'The channel, campaign, or source that generated the lead.',
    objectTypes: ['contacts', 'companies', 'deals'],
    expectedTypes: ['enumeration', 'string'],
    keywords: ['lead source', 'source', 'original source', 'acquisition source', 'channel', 'campaign source']
  },
  {
    key: 'market',
    label: 'Market',
    description: 'Commercial market, region, territory, or business geography.',
    objectTypes: ['contacts', 'companies', 'deals'],
    expectedTypes: ['enumeration', 'string'],
    keywords: ['market', 'region', 'territory', 'geo', 'geography', 'business region']
  },
  {
    key: 'country',
    label: 'Country',
    description: 'Country associated with the CRM record.',
    objectTypes: ['contacts', 'companies', 'deals'],
    expectedTypes: ['enumeration', 'string'],
    keywords: ['country', 'country code', 'nation', 'market country']
  },
  {
    key: 'product',
    label: 'Product',
    description: 'Product, service, package, or solution associated with a record.',
    objectTypes: ['companies', 'deals'],
    expectedTypes: ['enumeration', 'string'],
    keywords: ['product', 'service', 'package', 'solution', 'plan', 'offering']
  },
  {
    key: 'customer_segment',
    label: 'Customer Segment',
    description: 'Account or customer segmentation and classification.',
    objectTypes: ['companies', 'contacts', 'deals'],
    expectedTypes: ['enumeration', 'string'],
    keywords: ['customer segment', 'account segment', 'segment', 'customer tier', 'company size', 'account tier']
  },
  {
    key: 'account_status',
    label: 'Account Status',
    description: 'Active, churned, prospect, inactive, or other account state.',
    objectTypes: ['companies', 'contacts'],
    expectedTypes: ['enumeration', 'string'],
    keywords: ['account status', 'customer status', 'client status', 'status', 'active churned', 'retention status']
  },
  {
    key: 'meeting_outcome',
    label: 'Meeting Outcome',
    description: 'Business outcome or result of a meeting.',
    objectTypes: ['meetings'],
    expectedTypes: ['enumeration', 'string'],
    keywords: ['meeting outcome', 'meeting result', 'outcome', 'no show', 'completed meeting']
  },
  {
    key: 'call_outcome',
    label: 'Call Outcome',
    description: 'Business result or disposition of a call.',
    objectTypes: ['calls'],
    expectedTypes: ['enumeration', 'string'],
    keywords: ['call outcome', 'call disposition', 'disposition', 'connected', 'wrong number']
  },
  {
    key: 'renewal_date',
    label: 'Renewal Date',
    description: 'The next contract, subscription, or service renewal date.',
    objectTypes: ['companies', 'deals'],
    expectedTypes: ['date', 'datetime'],
    keywords: ['renewal date', 'contract renewal', 'subscription renewal', 'expiry date', 'expiration date', 'renewal month']
  },
  {
    key: 'revenue',
    label: 'Revenue',
    description: 'Revenue, ARR, MRR, amount, budget, or commercial value.',
    objectTypes: ['deals', 'companies'],
    expectedTypes: ['number'],
    keywords: ['revenue', 'amount', 'arr', 'mrr', 'annual revenue', 'contract value', 'budget', 'booked value']
  }
];

export async function withTransaction(handler) {
  const client = await postgres.connect();

  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedSemanticFields(client) {
  for (const field of semanticFields) {
    await client.query(
      `
        INSERT INTO semantic_fields (
          semantic_key,
          label,
          description,
          object_types,
          expected_types,
          keyword_hints,
          updated_at
        ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, NOW())
        ON CONFLICT (semantic_key) DO UPDATE SET
          label = EXCLUDED.label,
          description = EXCLUDED.description,
          object_types = EXCLUDED.object_types,
          expected_types = EXCLUDED.expected_types,
          keyword_hints = EXCLUDED.keyword_hints,
          updated_at = NOW()
      `,
      [
        field.key,
        field.label,
        field.description,
        JSON.stringify(field.objectTypes),
        JSON.stringify(field.expectedTypes),
        JSON.stringify(field.keywords)
      ]
    );
  }
}

export async function runMigrations() {
  const client = await postgres.connect();

  try {
    await client.query('SELECT pg_advisory_lock(812341229)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const migration of migrations) {
      const existing = await client.query(
        'SELECT 1 FROM schema_migrations WHERE version = $1',
        [migration.version]
      );

      if (existing.rowCount > 0) continue;

      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations(version, name) VALUES ($1, $2)',
          [migration.version, migration.name]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    await seedSemanticFields(client);
  } finally {
    await client.query('SELECT pg_advisory_unlock(812341229)').catch(() => undefined);
    client.release();
  }
}
