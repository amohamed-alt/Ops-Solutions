import Fastify from 'fastify';
import Redis from 'ioredis';

import { config, assertRuntimeConfiguration, getHubSpotConfigurationStatus } from './config.js';
import { encryptSecret, hashValue, randomToken, secureStringEquals } from './crypto.js';
import {
  ensureCustomerAuthSchema,
  registerCustomerAuthRoutes,
  sanitizeReturnPath
} from './customer-auth.js';
import { postgres, runMigrations, withTransaction } from './database.js';
import { discoverWorkspacePortal } from './discovery.js';
import {
  createAuthorizationUrl,
  exchangeAuthorizationCode,
  getConnectionForWorkspace,
  HubSpotApiError
} from './hubspot.js';
import { registerBackgroundExportRoutes } from './background-exports.js';
import { ensureMappingWizardSchema, registerMappingWizardRoutes } from './mapping-wizard.js';
import { inferValueMapping } from './semantic.js';
import { registerCustomerReportExportRoutes } from './report-exports.js';
import { registerSavedViewRoutes } from './saved-views.js';
import { registerSyncOperationsRoutes } from './sync-operations.js';

assertRuntimeConfiguration();

const app = Fastify({
  logger: {
    level: config.logLevel,
    redact: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers.x-admin-key',
      'req.headers.x-session-token',
      'req.body.password',
      'req.query.code',
      'req.query.state',
      'DATABASE_URL',
      'REDIS_URL',
      'HUBSPOT_CLIENT_SECRET',
      'ENCRYPTION_KEY'
    ]
  }
});

const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
  enableReadyCheck: true
});

function slugify(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
}

async function requireAdmin(request, reply) {
  if (!config.adminApiKey) {
    if (config.nodeEnv !== 'production') return;
    return reply.code(503).send({
      error: 'admin_api_key_not_configured',
      message: 'ADMIN_API_KEY must be configured before using administrative endpoints.'
    });
  }

  const supplied = request.headers['x-admin-key'];
  if (typeof supplied !== 'string' || !secureStringEquals(supplied, config.adminApiKey)) {
    return reply.code(401).send({
      error: 'unauthorized',
      message: 'A valid x-admin-key header is required.'
    });
  }
}

async function requireWorkspace(workspaceId) {
  if (!isUuid(workspaceId)) {
    const error = new Error('Invalid workspace ID');
    error.statusCode = 400;
    throw error;
  }

  const result = await postgres.query(
    'SELECT id, name, slug, status, created_at, updated_at FROM workspaces WHERE id = $1',
    [workspaceId]
  );
  if (result.rowCount === 0) {
    const error = new Error('Workspace not found');
    error.statusCode = 404;
    throw error;
  }
  return result.rows[0];
}

async function checkDependencies() {
  const startedAt = Date.now();
  const [databaseResult, redisResult] = await Promise.all([
    postgres.query('SELECT 1 AS healthy'),
    redis.ping()
  ]);
  return {
    database: databaseResult.rows[0]?.healthy === 1 ? 'healthy' : 'unhealthy',
    redis: redisResult === 'PONG' ? 'healthy' : 'unhealthy',
    responseTimeMs: Date.now() - startedAt
  };
}

app.get('/', async () => ({
  service: 'ops-solutions-api',
  status: 'running',
  version: '0.6.0'
}));

app.get('/health', async (_request, reply) => {
  try {
    const dependencies = await checkDependencies();
    return {
      status: 'healthy',
      service: 'api',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      dependencies
    };
  } catch (error) {
    app.log.error({ error }, 'Health check failed');
    return reply.code(503).send({
      status: 'unhealthy',
      service: 'api',
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/api/v1/platform', async () => ({
  product: 'Ops Solutions',
  stage: 'multi-tenant-revenue-intelligence',
  capabilities: [
    'customer accounts and secure sessions',
    'tenant-scoped workspace memberships',
    'owner, admin, and viewer role enforcement',
    'secure workspace invitation lifecycle',
    'workspace audit trail',
    'user-scoped saved reporting views',
    'tenant-scoped background report exports',
    'self-service HubSpot OAuth onboarding',
    'workspace persistence',
    'encrypted HubSpot OAuth tokens',
    'portal schema discovery',
    'owners and pipelines discovery',
    'semantic property suggestions',
    'customer mapping wizard',
    'mapping version history and rollback',
    'initial and incremental CRM synchronization',
    'sync health and manual recovery controls'
  ],
  hubspot: getHubSpotConfigurationStatus()
}));

const customerAuth = registerCustomerAuthRoutes(app, { postgres, withTransaction });

registerMappingWizardRoutes(app, {
  postgres,
  withTransaction,
  requireViewer: customerAuth.requireViewer,
  requireAdmin: customerAuth.requireAdmin,
  writeAudit: customerAuth.writeAudit
});

registerSavedViewRoutes(app, {
  postgres,
  withTransaction,
  requireViewer: customerAuth.requireViewer,
  writeAudit: customerAuth.writeAudit
});

registerCustomerReportExportRoutes(app, {
  postgres,
  redis,
  requireViewer: customerAuth.requireViewer,
  requireWorkspace,
  writeAudit: customerAuth.writeAudit
});

const backgroundExports = registerBackgroundExportRoutes(app, {
  postgres,
  redis,
  redisUrl: config.redisUrl,
  requireViewer: customerAuth.requireViewer,
  requireWorkspace,
  writeAudit: customerAuth.writeAudit
});

app.get('/api/v1/workspaces', { preHandler: requireAdmin }, async () => {
  const result = await postgres.query(`
    SELECT
      w.id, w.name, w.slug, w.status, w.created_at,
      c.portal_id, c.status AS hubspot_status, c.last_discovered_at
    FROM workspaces w
    LEFT JOIN hubspot_connections c ON c.workspace_id = w.id
    ORDER BY w.created_at DESC
  `);
  return { results: result.rows };
});

app.post('/api/v1/workspaces', { preHandler: requireAdmin }, async (request, reply) => {
  const name = String(request.body?.name ?? '').trim();
  const slug = slugify(request.body?.slug || name);
  if (name.length < 2 || name.length > 120 || !slug) {
    return reply.code(400).send({
      error: 'invalid_workspace',
      message: 'Workspace name must be between 2 and 120 characters.'
    });
  }

  try {
    const result = await postgres.query(
      `INSERT INTO workspaces(name, slug)
       VALUES ($1, $2)
       RETURNING id, name, slug, status, created_at, updated_at`,
      [name, slug]
    );
    return reply.code(201).send(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return reply.code(409).send({
        error: 'workspace_slug_exists',
        message: 'A workspace with this slug already exists.'
      });
    }
    throw error;
  }
});

app.get('/api/v1/workspaces/:workspaceId/setup', { preHandler: requireAdmin }, async (request) => {
  const workspace = await requireWorkspace(request.params.workspaceId);
  const [connection, countsResult, mappingsResult, suggestionsResult, latestDiscoveryResult] = await Promise.all([
    getConnectionForWorkspace(workspace.id),
    postgres.query(
      `SELECT object_type, COUNT(*)::int AS count
       FROM crm_properties
       WHERE workspace_id = $1
       GROUP BY object_type
       ORDER BY object_type`,
      [workspace.id]
    ),
    postgres.query('SELECT COUNT(*)::int AS count FROM property_mappings WHERE workspace_id = $1', [workspace.id]),
    postgres.query(
      `SELECT COUNT(*)::int AS count
       FROM property_mapping_suggestions
       WHERE workspace_id = $1 AND status = 'suggested'`,
      [workspace.id]
    ),
    postgres.query(
      `SELECT status, summary, error, started_at, completed_at
       FROM discovery_runs
       WHERE workspace_id = $1
       ORDER BY started_at DESC
       LIMIT 1`,
      [workspace.id]
    )
  ]);

  return {
    workspace,
    hubspot: connection ? {
      portalId: Number(connection.portal_id),
      status: connection.status,
      scopes: connection.scopes,
      connectedAt: connection.connected_at,
      lastDiscoveredAt: connection.last_discovered_at,
      lastError: connection.last_error
    } : null,
    propertyCounts: countsResult.rows,
    approvedMappings: mappingsResult.rows[0].count,
    pendingSuggestions: suggestionsResult.rows[0].count,
    latestDiscovery: latestDiscoveryResult.rows[0] ?? null,
    configuration: getHubSpotConfigurationStatus()
  };
});

app.get('/api/v1/workspaces/:workspaceId/hubspot/oauth/start', { preHandler: requireAdmin }, async (request) => {
  const workspace = await requireWorkspace(request.params.workspaceId);
  const state = randomToken(32);
  const redirectPath = sanitizeReturnPath(request.query?.returnTo, '/setup');
  await postgres.query('DELETE FROM oauth_states WHERE expires_at < NOW() OR consumed_at IS NOT NULL');
  await postgres.query(
    `INSERT INTO oauth_states(state_hash, workspace_id, redirect_path, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes')`,
    [hashValue(state), workspace.id, redirectPath]
  );
  return { authorizationUrl: createAuthorizationUrl(state), expiresInSeconds: 600 };
});

app.get('/api/v1/hubspot/oauth/callback', async (request, reply) => {
  const code = String(request.query?.code ?? '');
  const state = String(request.query?.state ?? '');
  const oauthError = String(request.query?.error ?? '');
  if (oauthError) {
    const redirectUrl = new URL('/onboarding', config.appUrl);
    redirectUrl.searchParams.set('hubspot', 'denied');
    return reply.redirect(redirectUrl.toString());
  }
  if (!code || !state) {
    return reply.code(400).send({
      error: 'invalid_oauth_callback',
      message: 'OAuth callback requires code and state parameters.'
    });
  }

  const oauthContext = await withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE oauth_states
       SET consumed_at = NOW()
       WHERE state_hash = $1 AND consumed_at IS NULL AND expires_at > NOW()
       RETURNING workspace_id, redirect_path`,
      [hashValue(state)]
    );
    if (result.rowCount === 0) {
      const error = new Error('OAuth state is invalid, expired, or already used');
      error.statusCode = 400;
      throw error;
    }
    return result.rows[0];
  });

  const workspaceId = oauthContext.workspace_id;
  const tokenPayload = await exchangeAuthorizationCode(code);
  const portalId = Number(tokenPayload.hub_id);
  if (!Number.isSafeInteger(portalId) || !tokenPayload.access_token || !tokenPayload.refresh_token) {
    throw new HubSpotApiError('HubSpot returned an incomplete OAuth token response', {
      statusCode: 502,
      category: 'INVALID_TOKEN_RESPONSE'
    });
  }

  const expiresAt = new Date(Date.now() + Number(tokenPayload.expires_in ?? 1800) * 1000);
  await postgres.query(
    `INSERT INTO hubspot_connections (
       workspace_id, portal_id, access_token_encrypted, refresh_token_encrypted,
       token_expires_at, scopes, status, connected_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'connected', NOW(), NOW())
     ON CONFLICT (workspace_id) DO UPDATE SET
       portal_id = EXCLUDED.portal_id,
       access_token_encrypted = EXCLUDED.access_token_encrypted,
       refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
       token_expires_at = EXCLUDED.token_expires_at,
       scopes = EXCLUDED.scopes,
       status = 'connected',
       last_error = NULL,
       connected_at = NOW(),
       updated_at = NOW()`,
    [
      workspaceId,
      portalId,
      encryptSecret(tokenPayload.access_token),
      encryptSecret(tokenPayload.refresh_token),
      expiresAt,
      JSON.stringify(tokenPayload.scopes ?? [])
    ]
  );
  await customerAuth.writeAudit(request, {
    workspaceId,
    action: 'hubspot.connected',
    targetType: 'portal',
    targetId: String(portalId),
    metadata: { scopes: tokenPayload.scopes ?? [] }
  });

  const redirectPath = sanitizeReturnPath(oauthContext.redirect_path, config.hubspot.successRedirectUri || '/setup');
  const redirectUrl = new URL(redirectPath, config.appUrl);
  redirectUrl.searchParams.set('hubspot', 'connected');
  redirectUrl.searchParams.set('workspaceId', workspaceId);
  redirectUrl.searchParams.set('portalId', String(portalId));
  return reply.redirect(redirectUrl.toString());
});

app.post('/api/v1/workspaces/:workspaceId/hubspot/discover', { preHandler: requireAdmin }, async (request) => {
  const workspace = await requireWorkspace(request.params.workspaceId);
  const summary = await discoverWorkspacePortal(workspace.id);
  return { status: 'completed', summary };
});

app.get('/api/v1/workspaces/:workspaceId/properties', { preHandler: requireAdmin }, async (request) => {
  const workspace = await requireWorkspace(request.params.workspaceId);
  const objectType = String(request.query?.objectType ?? '').trim();
  const values = [workspace.id];
  const filter = objectType ? 'AND object_type = $2' : '';
  if (objectType) values.push(objectType);
  const result = await postgres.query(
    `SELECT object_type, property_name, label, description, group_name,
            field_type, data_type, hubspot_defined, options, discovered_at
     FROM crm_properties
     WHERE workspace_id = $1 ${filter}
     ORDER BY object_type, hubspot_defined, label
     LIMIT 5000`,
    values
  );
  return { results: result.rows };
});

app.get('/api/v1/workspaces/:workspaceId/mapping-suggestions', { preHandler: requireAdmin }, async (request) => {
  const workspace = await requireWorkspace(request.params.workspaceId);
  const result = await postgres.query(
    `SELECT
       s.id, s.semantic_key, f.label AS semantic_label,
       f.description AS semantic_description, s.object_type, s.property_name,
       p.label AS property_label, p.description AS property_description,
       p.field_type, p.data_type, p.options, s.confidence, s.reasons, s.status
     FROM property_mapping_suggestions s
     JOIN semantic_fields f ON f.semantic_key = s.semantic_key
     JOIN crm_properties p
       ON p.workspace_id = s.workspace_id
      AND p.object_type = s.object_type
      AND p.property_name = s.property_name
     WHERE s.workspace_id = $1
     ORDER BY s.semantic_key, s.object_type, s.confidence DESC`,
    [workspace.id]
  );
  return { results: result.rows };
});

app.get('/api/v1/workspaces/:workspaceId/mappings', { preHandler: requireAdmin }, async (request) => {
  const workspace = await requireWorkspace(request.params.workspaceId);
  const result = await postgres.query(
    `SELECT m.*, f.label AS semantic_label, p.label AS property_label
     FROM property_mappings m
     JOIN semantic_fields f ON f.semantic_key = m.semantic_key
     JOIN crm_properties p
       ON p.workspace_id = m.workspace_id
      AND p.object_type = m.object_type
      AND p.property_name = m.property_name
     WHERE m.workspace_id = $1
     ORDER BY f.label, m.object_type`,
    [workspace.id]
  );
  return { results: result.rows };
});

app.post('/api/v1/workspaces/:workspaceId/mappings/:semanticKey/approve', { preHandler: requireAdmin }, async (request, reply) => {
  const workspace = await requireWorkspace(request.params.workspaceId);
  const semanticKey = String(request.params.semanticKey ?? '').trim();
  const objectType = String(request.body?.objectType ?? '').trim();
  const propertyName = String(request.body?.propertyName ?? '').trim();
  const suppliedValueMapping = request.body?.valueMapping;
  if (!semanticKey || !objectType || !propertyName) {
    return reply.code(400).send({
      error: 'invalid_mapping',
      message: 'semanticKey, objectType, and propertyName are required.'
    });
  }

  const propertyResult = await postgres.query(
    `SELECT options FROM crm_properties
     WHERE workspace_id = $1 AND object_type = $2 AND property_name = $3`,
    [workspace.id, objectType, propertyName]
  );
  if (propertyResult.rowCount === 0) {
    return reply.code(404).send({
      error: 'property_not_found',
      message: 'The selected HubSpot property was not found in the latest discovery.'
    });
  }

  const valueMapping = suppliedValueMapping && typeof suppliedValueMapping === 'object'
    ? suppliedValueMapping
    : inferValueMapping(semanticKey, propertyResult.rows[0].options);

  return withTransaction(async (client) => {
    const mappingResult = await client.query(
      `INSERT INTO property_mappings (
         workspace_id, semantic_key, object_type, property_name,
         value_mapping, source, approved_by, updated_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, 'user_approved', 'bootstrap_admin', NOW())
       ON CONFLICT (workspace_id, semantic_key, object_type)
       DO UPDATE SET
         property_name = EXCLUDED.property_name,
         value_mapping = EXCLUDED.value_mapping,
         source = EXCLUDED.source,
         approved_by = EXCLUDED.approved_by,
         updated_at = NOW()
       RETURNING *`,
      [workspace.id, semanticKey, objectType, propertyName, JSON.stringify(valueMapping)]
    );
    await client.query(
      `UPDATE property_mapping_suggestions
       SET status = CASE WHEN property_name = $4 THEN 'approved' ELSE 'rejected' END,
           updated_at = NOW()
       WHERE workspace_id = $1 AND semantic_key = $2 AND object_type = $3`,
      [workspace.id, semanticKey, objectType, propertyName]
    );
    return mappingResult.rows[0];
  });
});

const syncOperations = registerSyncOperationsRoutes(app, {
  postgres,
  redisUrl: config.redisUrl,
  requireAdmin,
  requireWorkspace
});

app.setErrorHandler((error, request, reply) => {
  const statusCode = Number(error.statusCode) >= 400 ? Number(error.statusCode) : 500;
  request.log.error({ error, statusCode }, 'Request failed');
  reply.code(statusCode).send({
    error: error.category ?? (statusCode >= 500 ? 'internal_server_error' : 'request_error'),
    message: statusCode >= 500 && !(error instanceof HubSpotApiError)
      ? 'An unexpected error occurred.'
      : error.message,
    details: error instanceof HubSpotApiError ? error.details : undefined
  });
});

async function shutdown(signal) {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  await Promise.allSettled([
    backgroundExports.close(),
    syncOperations.close(),
    postgres.end(),
    redis.quit()
  ]);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await redis.connect();
  await postgres.query('SELECT 1');
  await runMigrations({ throughVersion: 1 });
  await ensureCustomerAuthSchema(postgres);
  await runMigrations();
  await ensureMappingWizardSchema(postgres);
  await backgroundExports.start();
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.fatal({ error }, 'API failed to start');
  await Promise.allSettled([
    backgroundExports.close(),
    syncOperations.close(),
    postgres.end(),
    redis.quit()
  ]);
  process.exit(1);
}
