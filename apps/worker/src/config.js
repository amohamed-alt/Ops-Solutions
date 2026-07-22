const required = ['DATABASE_URL', 'REDIS_URL'];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`${key} is required`);
  }
}

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function list(value, fallback) {
  const parsed = String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
}

export const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? 'production',
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  encryptionKey: process.env.ENCRYPTION_KEY ?? process.env.TOKEN_ENCRYPTION_KEY ?? '',
  hubspot: Object.freeze({
    clientId: process.env.HUBSPOT_CLIENT_ID ?? '',
    clientSecret: process.env.HUBSPOT_CLIENT_SECRET ?? '',
    apiBaseUrl: process.env.HUBSPOT_API_BASE_URL ?? 'https://api.hubapi.com',
    tokenUrl: process.env.HUBSPOT_TOKEN_URL ?? 'https://api.hubspot.com/oauth/2026-03/token',
    objectTypes: list(process.env.HUBSPOT_SYNC_OBJECTS, [
      'contacts',
      'companies',
      'deals',
      'calls',
      'meetings',
      'tasks'
    ]),
    pageSize: positiveInteger(process.env.HUBSPOT_SYNC_PAGE_SIZE, 100, { min: 10, max: 100 }),
    requestDelayMs: positiveInteger(process.env.HUBSPOT_REQUEST_DELAY_MS, 240, { min: 100, max: 5000 })
  }),
  sync: Object.freeze({
    schedulerIntervalMs: positiveInteger(process.env.SYNC_SCHEDULER_INTERVAL_MS, 300_000, {
      min: 60_000,
      max: 3_600_000
    }),
    incrementalIntervalMinutes: positiveInteger(process.env.SYNC_INCREMENTAL_INTERVAL_MINUTES, 15, {
      min: 5,
      max: 1440
    }),
    fullReconciliationHours: positiveInteger(process.env.SYNC_FULL_RECONCILIATION_HOURS, 24, {
      min: 1,
      max: 168
    }),
    maxPagesPerRun: positiveInteger(process.env.SYNC_MAX_PAGES_PER_RUN, 500, {
      min: 1,
      max: 5000
    })
  })
});

export function assertHubSpotWorkerConfiguration() {
  const missing = [];

  if (!config.encryptionKey) missing.push('ENCRYPTION_KEY');
  if (!config.hubspot.clientId) missing.push('HUBSPOT_CLIENT_ID');
  if (!config.hubspot.clientSecret) missing.push('HUBSPOT_CLIENT_SECRET');

  if (missing.length > 0) {
    throw new Error(`HubSpot worker configuration is incomplete: ${missing.join(', ')}`);
  }
}
