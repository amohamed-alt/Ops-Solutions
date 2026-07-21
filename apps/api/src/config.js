const DEFAULT_HUBSPOT_SCOPES = [
  'oauth',
  'crm.objects.contacts.read',
  'crm.objects.companies.read',
  'crm.objects.deals.read',
  'crm.objects.owners.read',
  'crm.schemas.contacts.read',
  'crm.schemas.companies.read',
  'crm.schemas.deals.read'
];

const DEFAULT_OPTIONAL_HUBSPOT_SCOPES = [
  'crm.schemas.custom.read'
];

function splitScopes(value, fallback) {
  if (!value?.trim()) {
    return fallback;
  }

  return [...new Set(value.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean))];
}

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

export const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  host: '0.0.0.0',
  port: parsePort(process.env.PORT, 3001),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  appUrl: process.env.APP_URL ?? 'http://localhost:3210',
  adminApiKey: process.env.ADMIN_API_KEY ?? '',
  encryptionKey: process.env.ENCRYPTION_KEY ?? process.env.TOKEN_ENCRYPTION_KEY ?? '',
  hubspot: Object.freeze({
    clientId: process.env.HUBSPOT_CLIENT_ID ?? '',
    clientSecret: process.env.HUBSPOT_CLIENT_SECRET ?? '',
    redirectUri: process.env.HUBSPOT_REDIRECT_URI ?? '',
    successRedirectUri: process.env.HUBSPOT_SUCCESS_REDIRECT_URI ?? '',
    authorizationUrl: 'https://app.hubspot.com/oauth/authorize',
    tokenUrl: 'https://api.hubspot.com/oauth/2026-03/token',
    apiBaseUrl: 'https://api.hubapi.com',
    scopes: splitScopes(process.env.HUBSPOT_SCOPES, DEFAULT_HUBSPOT_SCOPES),
    optionalScopes: splitScopes(
      process.env.HUBSPOT_OPTIONAL_SCOPES,
      DEFAULT_OPTIONAL_HUBSPOT_SCOPES
    )
  })
});

export function assertRuntimeConfiguration() {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  if (!config.redisUrl) {
    throw new Error('REDIS_URL is required');
  }
}

export function getHubSpotConfigurationStatus() {
  const missing = [];

  if (!config.hubspot.clientId) missing.push('HUBSPOT_CLIENT_ID');
  if (!config.hubspot.clientSecret) missing.push('HUBSPOT_CLIENT_SECRET');
  if (!config.hubspot.redirectUri) missing.push('HUBSPOT_REDIRECT_URI');
  if (!config.encryptionKey) missing.push('ENCRYPTION_KEY');

  return {
    configured: missing.length === 0,
    missing,
    scopes: config.hubspot.scopes,
    optionalScopes: config.hubspot.optionalScopes
  };
}
