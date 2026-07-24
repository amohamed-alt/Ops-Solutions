import { pathToFileURL } from 'node:url';

import {
  ensureOnboardingReadinessSchema,
  evaluateAndPersistReadiness
} from './onboarding-readiness.js';

const FLEET_LOCK = 812341271;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_FRESHNESS_HOURS = 24;
const DEFAULT_RETENTION_DAYS = 180;
const DEFAULT_MIN_SNAPSHOTS = 30;
const MAX_WORKSPACES = 10_000;

function operationError(message, category = 'ONBOARDING_READINESS_OPERATIONS_INVALID') {
  const error = new Error(message);
  error.category = category;
  return error;
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export async function withDatabaseTransaction(postgres, operation) {
  const client = await postgres.connect();
  try {
    await client.query('BEGIN');
    try {
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export function summarizeFleetResults(results) {
  const summary = {
    evaluated: results.length,
    ready: 0,
    blocked: 0,
    transitioned: 0,
    failed: 0
  };
  for (const result of results) {
    if (!result.ok) summary.failed += 1;
    else {
      if (result.ready) summary.ready += 1;
      else summary.blocked += 1;
      if (result.transitioned) summary.transitioned += 1;
    }
  }
  return summary;
}

export async function evaluateReadinessFleet({
  postgres,
  concurrency = DEFAULT_CONCURRENCY,
  freshnessHours = DEFAULT_FRESHNESS_HOURS,
  limit = MAX_WORKSPACES,
  evaluator = evaluateAndPersistReadiness,
  ensureSchema = ensureOnboardingReadinessSchema,
  now = new Date()
}) {
  if (!postgres?.query || !postgres?.connect) throw operationError('A PostgreSQL pool is required.');
  const boundedConcurrency = boundedInteger(concurrency, DEFAULT_CONCURRENCY, 1, 10);
  const boundedFreshnessHours = boundedInteger(freshnessHours, DEFAULT_FRESHNESS_HOURS, 1, 168);
  const boundedLimit = boundedInteger(limit, MAX_WORKSPACES, 1, MAX_WORKSPACES);

  await ensureSchema(postgres);
  const lockClient = await postgres.connect();
  let locked = false;
  try {
    const lockResult = await lockClient.query('SELECT pg_try_advisory_lock($1) AS locked', [FLEET_LOCK]);
    locked = Boolean(lockResult.rows[0]?.locked);
    if (!locked) {
      return {
        skipped: true,
        reason: 'another_fleet_evaluation_is_running',
        generatedAt: now.toISOString(),
        summary: { evaluated: 0, ready: 0, blocked: 0, transitioned: 0, failed: 0 },
        results: []
      };
    }

    const workspaceResult = await postgres.query(
      `SELECT id,name FROM workspaces
       WHERE status='active'
       ORDER BY created_at ASC,id ASC
       LIMIT $1`,
      [boundedLimit]
    );

    const results = await mapWithConcurrency(workspaceResult.rows, boundedConcurrency, async (workspace) => {
      try {
        const report = await evaluator({
          postgres,
          withTransaction: (operation) => withDatabaseTransaction(postgres, operation),
          workspaceId: workspace.id,
          options: { freshnessHours: boundedFreshnessHours, now },
          userId: null,
          triggerSource: 'system'
        });
        return {
          ok: true,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          ready: report.summary.ready,
          score: report.summary.score,
          blockers: report.summary.blockers,
          warnings: report.summary.warnings,
          snapshotId: report.snapshot.id,
          transitioned: Boolean(report.snapshot.transitioned)
        };
      } catch (error) {
        return {
          ok: false,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          error: error?.category ?? 'ONBOARDING_READINESS_EVALUATION_FAILED',
          message: error instanceof Error ? error.message : 'Readiness evaluation failed.'
        };
      }
    });

    return {
      skipped: false,
      generatedAt: now.toISOString(),
      policy: {
        concurrency: boundedConcurrency,
        freshnessHours: boundedFreshnessHours,
        workspaceLimit: boundedLimit
      },
      summary: summarizeFleetResults(results),
      results
    };
  } finally {
    if (locked) await lockClient.query('SELECT pg_advisory_unlock($1)', [FLEET_LOCK]).catch(() => undefined);
    lockClient.release();
  }
}

export async function pruneReadinessSnapshots({
  postgres,
  retentionDays = DEFAULT_RETENTION_DAYS,
  minimumSnapshots = DEFAULT_MIN_SNAPSHOTS,
  workspaceId = null,
  dryRun = true
}) {
  if (!postgres?.query) throw operationError('A PostgreSQL pool is required.');
  const boundedRetentionDays = boundedInteger(retentionDays, DEFAULT_RETENTION_DAYS, 30, 3650);
  const boundedMinimumSnapshots = boundedInteger(minimumSnapshots, DEFAULT_MIN_SNAPSHOTS, 5, 500);
  if (workspaceId !== null && !/^[0-9a-f-]{36}$/i.test(String(workspaceId))) {
    throw operationError('A valid workspace UUID is required.');
  }

  const parameters = [boundedMinimumSnapshots, boundedRetentionDays];
  const workspaceFilter = workspaceId ? `AND workspace_id=$3` : '';
  if (workspaceId) parameters.push(workspaceId);

  const candidatesSql = `
    WITH ranked AS (
      SELECT id,workspace_id,created_at,transitioned,
             ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY created_at DESC,id DESC) AS snapshot_rank
      FROM onboarding_readiness_snapshots
      WHERE TRUE ${workspaceFilter}
    )
    SELECT id,workspace_id FROM ranked
    WHERE snapshot_rank > $1
      AND created_at < NOW() - ($2::text || ' days')::interval
      AND transitioned = FALSE`;

  if (dryRun) {
    const result = await postgres.query(
      `SELECT COUNT(*)::int AS candidate_count,COUNT(DISTINCT workspace_id)::int AS workspace_count
       FROM (${candidatesSql}) candidates`,
      parameters
    );
    return {
      dryRun: true,
      deleted: 0,
      candidates: Number(result.rows[0]?.candidate_count ?? 0),
      workspaces: Number(result.rows[0]?.workspace_count ?? 0),
      policy: { retentionDays: boundedRetentionDays, minimumSnapshots: boundedMinimumSnapshots, preservesTransitions: true }
    };
  }

  const result = await postgres.query(
    `DELETE FROM onboarding_readiness_snapshots snapshots
     USING (${candidatesSql}) candidates
     WHERE snapshots.id=candidates.id
     RETURNING snapshots.workspace_id`,
    parameters
  );
  return {
    dryRun: false,
    deleted: result.rowCount,
    workspaces: new Set(result.rows.map((row) => row.workspace_id)).size,
    policy: { retentionDays: boundedRetentionDays, minimumSnapshots: boundedMinimumSnapshots, preservesTransitions: true }
  };
}

function parseArgs(argv) {
  const options = { action: 'evaluate', format: 'text', dryRun: true };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--action') options.action = String(argv[++index] ?? '');
    else if (value === '--format') options.format = String(argv[++index] ?? '');
    else if (value === '--concurrency') options.concurrency = argv[++index];
    else if (value === '--freshness-hours') options.freshnessHours = argv[++index];
    else if (value === '--limit') options.limit = argv[++index];
    else if (value === '--retention-days') options.retentionDays = argv[++index];
    else if (value === '--minimum-snapshots') options.minimumSnapshots = argv[++index];
    else if (value === '--workspace') options.workspaceId = argv[++index];
    else if (value === '--apply') options.dryRun = false;
    else if (value === '--dry-run') options.dryRun = true;
    else if (value === '--help') options.help = true;
    else throw operationError(`Unknown argument: ${value}`);
  }
  if (!['evaluate', 'prune'].includes(options.action)) throw operationError('Action must be evaluate or prune.');
  if (!['text', 'json'].includes(options.format)) throw operationError('Format must be text or json.');
  return options;
}

function renderText(result, action) {
  if (action === 'prune') {
    return `${result.dryRun ? 'Readiness snapshot prune preview' : 'Readiness snapshots pruned'}: ${result.dryRun ? result.candidates : result.deleted} snapshots across ${result.workspaces} workspaces.`;
  }
  if (result.skipped) return 'Fleet readiness evaluation skipped: another evaluation is already running.';
  return `Fleet readiness: ${result.summary.evaluated} evaluated, ${result.summary.ready} ready, ${result.summary.blocked} blocked, ${result.summary.transitioned} transitions, ${result.summary.failed} failed.`;
}

async function runCli() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node apps/api/src/onboarding-readiness-operations.js --action evaluate|prune [--format text|json] [--apply]');
    return;
  }
  const { postgres } = await import('./database.js');
  try {
    const result = options.action === 'evaluate'
      ? await evaluateReadinessFleet({ postgres, ...options })
      : await pruneReadinessSnapshots({ postgres, ...options });
    console.log(options.format === 'json' ? JSON.stringify(result, null, 2) : renderText(result, options.action));
    if (options.action === 'evaluate' && !result.skipped && result.summary.failed > 0) process.exitCode = 2;
  } finally {
    await postgres.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runCli().catch((error) => {
    console.error(JSON.stringify({ error: error.category ?? 'ONBOARDING_READINESS_OPERATIONS_FAILED', message: error.message }));
    process.exitCode = 4;
  });
}
