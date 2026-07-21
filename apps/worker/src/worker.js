import fs from 'node:fs/promises';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import pg from 'pg';

const { Pool } = pg;

const redisUrl = process.env.REDIS_URL;
const databaseUrl = process.env.DATABASE_URL;

if (!redisUrl) {
  throw new Error('REDIS_URL is required');
}

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true
});

const postgres = new Pool({
  connectionString: databaseUrl,
  max: 3,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

const queueWorker = new Worker(
  'hubspot-sync',
  async (job) => {
    const startedAt = Date.now();

    console.log(JSON.stringify({
      level: 'info',
      event: 'job_started',
      queue: 'hubspot-sync',
      jobId: job.id,
      jobName: job.name
    }));

    switch (job.name) {
      case 'portal-discovery':
      case 'initial-sync':
      case 'incremental-sync':
        return {
          status: 'accepted',
          jobName: job.name,
          durationMs: Date.now() - startedAt
        };
      default:
        throw new Error(`Unsupported job type: ${job.name}`);
    }
  },
  {
    connection: redis,
    concurrency: 1,
    lockDuration: 120_000
  }
);

queueWorker.on('completed', (job, result) => {
  console.log(JSON.stringify({
    level: 'info',
    event: 'job_completed',
    jobId: job.id,
    result
  }));
});

queueWorker.on('failed', (job, error) => {
  console.error(JSON.stringify({
    level: 'error',
    event: 'job_failed',
    jobId: job?.id,
    error: error.message
  }));
});

async function heartbeat() {
  const timestamp = Date.now();

  await Promise.all([
    fs.writeFile('/tmp/worker-heartbeat', String(timestamp), 'utf8'),
    redis.set('ops-solutions:worker:heartbeat', String(timestamp), 'EX', 120),
    postgres.query('SELECT 1')
  ]);
}

let heartbeatTimer;

async function shutdown(signal) {
  console.log(JSON.stringify({
    level: 'info',
    event: 'worker_shutdown',
    signal
  }));

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }

  await Promise.allSettled([
    queueWorker.close(),
    postgres.end(),
    redis.quit()
  ]);

  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await heartbeat();

  heartbeatTimer = setInterval(() => {
    void heartbeat().catch((error) => {
      console.error(JSON.stringify({
        level: 'error',
        event: 'heartbeat_failed',
        error: error.message
      }));
    });
  }, 30_000);

  console.log(JSON.stringify({
    level: 'info',
    event: 'worker_started',
    queue: 'hubspot-sync',
    concurrency: 1
  }));
} catch (error) {
  console.error(JSON.stringify({
    level: 'fatal',
    event: 'worker_start_failed',
    error: error.message
  }));

  await Promise.allSettled([
    queueWorker.close(),
    postgres.end(),
    redis.quit()
  ]);

  process.exit(1);
}
