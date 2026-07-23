import fs from 'node:fs/promises';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import pg from 'pg';

import { ensureAnalyticsIndexes, runPlannerMaintenance } from './analytics-maintenance.js';
import { config, assertHubSpotWorkerConfiguration } from './config.js';
import { ensureSyncSchema, syncWorkspace, workspacesDueForSync } from './sync.js';
import { syncWebhookEvents } from './targeted-sync.js';

const { Pool } = pg;

const workerRedis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true
});

const queueRedis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true
});

const heartbeatRedis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 2,
  enableReadyCheck: true
});

const postgres = new Pool({
  connectionString: config.databaseUrl,
  max: 4,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

const syncQueue = new Queue('hubspot-sync', {
  connection: queueRedis,
  defaultJobOptions: {
    attempts: 4,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 86_400, count: 1000 },
    removeOnFail: { age: 604_800, count: 1000 }
  }
});

function log(level, event, details = {}) {
  const writer = level === 'error' || level === 'fatal' ? console.error : console.log;
  writer(JSON.stringify({
    level,
    event,
    timestamp: new Date().toISOString(),
    ...details
  }));
}

function requireWorkspaceId(job) {
  const workspaceId = String(job.data?.workspaceId ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) {
    throw new Error(`Job ${job.id} is missing a valid workspaceId`);
  }
  return workspaceId;
}

const queueWorker = new Worker(
  'hubspot-sync',
  async (job) => {
    const startedAt = Date.now();
    log('info', 'job_started', {
      queue: 'hubspot-sync',
      jobId: job.id,
      jobName: job.name,
      attempt: job.attemptsMade + 1
    });

    if (job.name === 'portal-discovery') {
      return {
        status: 'deferred_to_api',
        jobName: job.name,
        durationMs: Date.now() - startedAt
      };
    }

    const workspaceId = requireWorkspaceId(job);
    if (job.data?.source === 'hubspot_webhook') {
      const result = await syncWebhookEvents(postgres, workspaceId);
      return {
        ...result,
        workspaceId,
        jobName: job.name,
        source: 'hubspot_webhook',
        durationMs: Date.now() - startedAt
      };
    }

    let mode;
    switch (job.name) {
      case 'initial-sync':
        mode = 'initial';
        break;
      case 'full-sync':
        mode = 'full';
        break;
      case 'incremental-sync':
        mode = 'auto';
        break;
      default:
        throw new Error(`Unsupported job type: ${job.name}`);
    }

    const result = await syncWorkspace(postgres, workspaceId, mode);
    return {
      ...result,
      workspaceId,
      jobName: job.name,
      durationMs: Date.now() - startedAt
    };
  },
  {
    connection: workerRedis,
    concurrency: 1,
    lockDuration: 300_000,
    stalledInterval: 60_000,
    maxStalledCount: 2
  }
);

queueWorker.on('completed', (job, result) => {
  log('info', 'job_completed', {
    jobId: job.id,
    jobName: job.name,
    result
  });
});

queueWorker.on('failed', (job, error) => {
  log('error', 'job_failed', {
    jobId: job?.id,
    jobName: job?.name,
    attempt: (job?.attemptsMade ?? 0) + 1,
    error: error.message,
    summary: error.summary
  });
});

queueWorker.on('error', (error) => {
  log('error', 'worker_error', { error: error.message });
});

async function heartbeat() {
  const timestamp = Date.now();
  await Promise.all([
    fs.writeFile('/tmp/worker-heartbeat', String(timestamp), 'utf8'),
    heartbeatRedis.set('ops-solutions:worker:heartbeat', String(timestamp), 'EX', 120),
    postgres.query('SELECT 1')
  ]);
}

async function scheduleDueWorkspaces() {
  try {
    assertHubSpotWorkerConfiguration();
  } catch (error) {
    log('warn', 'sync_scheduler_disabled', { reason: error.message });
    return { scheduled: 0, disabled: true };
  }

  const due = await workspacesDueForSync(postgres);
  const intervalBucket = Math.floor(Date.now() / config.sync.schedulerIntervalMs);
  let scheduled = 0;

  for (const row of due) {
    const workspaceId = String(row.workspace_id);
    const jobName = row.last_success_at ? 'incremental-sync' : 'initial-sync';
    const jobId = `${jobName}-${workspaceId.replaceAll('-', '')}-${intervalBucket}`;

    await syncQueue.add(
      jobName,
      { workspaceId, scheduledAt: new Date().toISOString() },
      { jobId }
    );
    scheduled += 1;
  }

  if (scheduled > 0) {
    log('info', 'sync_jobs_scheduled', { scheduled });
  }

  return { scheduled, disabled: false };
}

async function maintainAnalyticsPlanner() {
  return runPlannerMaintenance(postgres, heartbeatRedis, { log });
}

let heartbeatTimer;
let schedulerTimer;
let maintenanceTimer;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  log('info', 'worker_shutdown', { signal });
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (schedulerTimer) clearInterval(schedulerTimer);
  if (maintenanceTimer) clearInterval(maintenanceTimer);

  await Promise.allSettled([
    queueWorker.close(),
    syncQueue.close(),
    postgres.end(),
    workerRedis.quit(),
    queueRedis.quit(),
    heartbeatRedis.quit()
  ]);

  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await ensureSyncSchema(postgres);
  const indexResult = await ensureAnalyticsIndexes(postgres, { log });
  await maintainAnalyticsPlanner();
  await heartbeat();
  await scheduleDueWorkspaces();

  heartbeatTimer = setInterval(() => {
    void heartbeat().catch((error) => {
      log('error', 'heartbeat_failed', { error: error.message });
    });
  }, 30_000);

  schedulerTimer = setInterval(() => {
    void scheduleDueWorkspaces().catch((error) => {
      log('error', 'sync_scheduler_failed', { error: error.message });
    });
  }, config.sync.schedulerIntervalMs);

  maintenanceTimer = setInterval(() => {
    void maintainAnalyticsPlanner().catch((error) => {
      log('error', 'analytics_planner_maintenance_failed', { error: error.message });
    });
  }, 60 * 60 * 1000);

  log('info', 'worker_started', {
    queue: 'hubspot-sync',
    concurrency: 1,
    schedulerIntervalMs: config.sync.schedulerIntervalMs,
    analyticsIndexes: indexResult.indexes,
    targetedWebhookSync: true,
    objectTypes: config.hubspot.objectTypes
  });
} catch (error) {
  log('fatal', 'worker_start_failed', { error: error.message });

  await Promise.allSettled([
    queueWorker.close(),
    syncQueue.close(),
    postgres.end(),
    workerRedis.quit(),
    queueRedis.quit(),
    heartbeatRedis.quit()
  ]);

  process.exit(1);
}
