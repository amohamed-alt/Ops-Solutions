import Fastify from 'fastify';
import Redis from 'ioredis';
import pg from 'pg';

const { Pool } = pg;

const port = Number.parseInt(process.env.PORT ?? '3001', 10);
const host = '0.0.0.0';
const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

if (!redisUrl) {
  throw new Error('REDIS_URL is required');
}

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: [
      'req.headers.authorization',
      'req.headers.cookie',
      'DATABASE_URL',
      'REDIS_URL'
    ]
  }
});

const postgres = new Pool({
  connectionString: databaseUrl,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

const redis = new Redis(redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
  enableReadyCheck: true
});

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
  version: '0.1.0'
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
  stage: 'platform-foundation',
  capabilities: [
    'multi-container runtime',
    'postgresql persistence',
    'redis queue infrastructure',
    'background worker',
    'health monitoring',
    'automatic deployment'
  ]
}));

app.setErrorHandler((error, request, reply) => {
  request.log.error({ error }, 'Unhandled request error');
  reply.code(500).send({
    error: 'internal_server_error',
    message: 'An unexpected error occurred.'
  });
});

async function shutdown(signal) {
  app.log.info({ signal }, 'Shutting down');

  await app.close();
  await Promise.allSettled([
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
  await app.listen({ port, host });
} catch (error) {
  app.log.fatal({ error }, 'API failed to start');
  await Promise.allSettled([
    postgres.end(),
    redis.quit()
  ]);
  process.exit(1);
}
