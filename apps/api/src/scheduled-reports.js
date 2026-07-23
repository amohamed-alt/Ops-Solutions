import { Queue } from 'bullmq';
import Redis from 'ioredis';

import { resolveDatePreset } from './report-exports.js';

const MIGRATION_VERSION = 5;
const MIGRATION_LOCK = 812341235;
const MAX_RECIPIENTS = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FREQUENCIES = new Set(['daily', 'weekly', 'monthly']);
const FORMATS = new Set(['csv', 'xlsx']);
const DELIVERY_MODES = new Set(['summary', 'attachment']);

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS scheduled_report_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_by_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    saved_view_id UUID NOT NULL REFERENCES saved_reporting_views(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    frequency TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
    weekday SMALLINT CHECK (weekday IS NULL OR weekday BETWEEN 0 AND 6),
    monthday SMALLINT CHECK (monthday IS NULL OR monthday BETWEEN 1 AND 28),
    delivery_hour SMALLINT NOT NULL CHECK (delivery_hour BETWEEN 0 AND 23),
    delivery_minute SMALLINT NOT NULL CHECK (delivery_minute BETWEEN 0 AND 59),
    timezone TEXT NOT NULL,
    recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
    format TEXT NOT NULL CHECK (format IN ('csv','xlsx')),
    delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('summary','attachment')),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    next_run_at TIMESTAMPTZ NOT NULL,
    last_run_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, name)
  );

  CREATE TABLE IF NOT EXISTS scheduled_report_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id UUID NOT NULL REFERENCES scheduled_report_schedules(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    export_job_id UUID REFERENCES report_export_jobs(id) ON DELETE SET NULL,
    scheduled_for TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued','exporting','ready_for_delivery','delivered','failed','skipped')),
    delivery_status TEXT NOT NULL DEFAULT 'provider_not_configured',
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE(schedule_id, scheduled_for)
  );

  CREATE INDEX IF NOT EXISTS scheduled_report_schedules_due_idx
    ON scheduled_report_schedules(enabled, next_run_at)
    WHERE enabled = TRUE;
  CREATE INDEX IF NOT EXISTS scheduled_report_schedules_workspace_idx
    ON scheduled_report_schedules(workspace_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS scheduled_report_executions_schedule_idx
    ON scheduled_report_executions(schedule_id, created_at DESC);
`;

export const SCHEDULED_REPORTS_ROLLBACK_SQL = `
  DROP TABLE IF EXISTS scheduled_report_executions;
  DROP TABLE IF EXISTS scheduled_report_schedules;
`;

function scheduleError(message, category = 'INVALID_REPORT_SCHEDULE', statusCode = 400) {
  const error = new Error(message);
  error.category = category;
  error.statusCode = statusCode;
  return error;
}

function normalizeUuid(value, label) {
  const id = String(value ?? '').trim();
  if (!UUID_PATTERN.test(id)) throw scheduleError(`${label} is invalid.`);
  return id;
}

function normalizeRecipients(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RECIPIENTS) {
    throw scheduleError(`Recipients must contain between 1 and ${MAX_RECIPIENTS} email addresses.`);
  }
  const recipients = [...new Set(value.map((item) => String(item ?? '').trim().toLowerCase()).filter(Boolean))];
  if (recipients.length === 0 || recipients.some((email) => !EMAIL_PATTERN.test(email))) {
    throw scheduleError('Every recipient must be a valid email address.');
  }
  return recipients;
}

function validTimezone(timezone) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', weekday: 'short'
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function timezoneOffsetMs(date, timezone) {
  const parts = localParts(date, timezone);
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - date.getTime();
}

function zonedDateToUtc(year, month, day, hour, minute, timezone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const first = new Date(guess.getTime() - timezoneOffsetMs(guess, timezone));
  return new Date(guess.getTime() - timezoneOffsetMs(first, timezone));
}

export function computeNextRun(input, from = new Date()) {
  const timezone = String(input.timezone ?? 'UTC');
  const frequency = String(input.frequency ?? 'weekly');
  const hour = Number(input.deliveryHour ?? 8);
  const minute = Number(input.deliveryMinute ?? 0);
  const weekday = Number(input.weekday ?? 1);
  const monthday = Number(input.monthday ?? 1);
  const local = localParts(from, timezone);
  const localToday = new Date(Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day)));

  for (let offset = 0; offset <= 370; offset += 1) {
    const candidateDay = new Date(localToday.getTime() + offset * 86_400_000);
    const candidateWeekday = candidateDay.getUTCDay();
    const candidateMonthday = candidateDay.getUTCDate();
    if (frequency === 'weekly' && candidateWeekday !== weekday) continue;
    if (frequency === 'monthly' && candidateMonthday !== monthday) continue;
    const candidate = zonedDateToUtc(
      candidateDay.getUTCFullYear(), candidateDay.getUTCMonth() + 1, candidateDay.getUTCDate(), hour, minute, timezone
    );
    if (candidate.getTime() > from.getTime() + 1_000) return candidate;
  }
  throw scheduleError('Unable to calculate the next delivery time.');
}

export function normalizeScheduleRequest(input = {}, from = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw scheduleError('Schedule request must be an object.');
  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 100);
  const savedViewId = normalizeUuid(input.savedViewId, 'Saved view ID');
  const frequency = String(input.frequency ?? 'weekly').trim().toLowerCase();
  const timezone = String(input.timezone ?? 'UTC').trim().slice(0, 100);
  const format = String(input.format ?? 'xlsx').trim().toLowerCase();
  const deliveryMode = String(input.deliveryMode ?? 'attachment').trim().toLowerCase();
  const deliveryHour = Number(input.deliveryHour ?? 8);
  const deliveryMinute = Number(input.deliveryMinute ?? 0);
  const weekday = frequency === 'weekly' ? Number(input.weekday ?? 1) : null;
  const monthday = frequency === 'monthly' ? Number(input.monthday ?? 1) : null;
  if (name.length < 2) throw scheduleError('Schedule name must contain at least 2 characters.');
  if (!FREQUENCIES.has(frequency)) throw scheduleError('Frequency must be daily, weekly, or monthly.');
  if (!FORMATS.has(format)) throw scheduleError('Format must be CSV or XLSX.');
  if (!DELIVERY_MODES.has(deliveryMode)) throw scheduleError('Delivery mode must be summary or attachment.');
  if (!validTimezone(timezone)) throw scheduleError('Timezone is invalid.');
  if (!Number.isInteger(deliveryHour) || deliveryHour < 0 || deliveryHour > 23) throw scheduleError('Delivery hour must be between 0 and 23.');
  if (!Number.isInteger(deliveryMinute) || deliveryMinute < 0 || deliveryMinute > 59) throw scheduleError('Delivery minute must be between 0 and 59.');
  if (weekday !== null && (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)) throw scheduleError('Weekday must be between 0 and 6.');
  if (monthday !== null && (!Number.isInteger(monthday) || monthday < 1 || monthday > 28)) throw scheduleError('Month day must be between 1 and 28.');
  const normalized = {
    name, savedViewId, frequency, timezone, format, deliveryMode,
    deliveryHour, deliveryMinute, weekday, monthday,
    recipients: normalizeRecipients(input.recipients),
    enabled: input.enabled !== false
  };
  return { ...normalized, nextRunAt: computeNextRun(normalized, from) };
}

export async function ensureScheduledReportSchema(postgres) {
  const client = await postgres.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${MIGRATION_LOCK})`);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const existing = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [MIGRATION_VERSION]);
    if (existing.rowCount > 0) return { applied: false, version: MIGRATION_VERSION };
    await client.query('BEGIN');
    try {
      await client.query(SCHEMA_SQL);
      await client.query('INSERT INTO schema_migrations(version, name) VALUES ($1, $2)', [MIGRATION_VERSION, 'scheduled_report_orchestration']);
      await client.query('COMMIT');
      return { applied: true, version: MIGRATION_VERSION };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${MIGRATION_LOCK})`).catch(() => undefined);
    client.release();
  }
}

function serialize(row) {
  return {
    id: row.id, workspaceId: row.workspace_id, savedViewId: row.saved_view_id,
    savedViewName: row.saved_view_name, name: row.name, frequency: row.frequency,
    weekday: row.weekday, monthday: row.monthday, deliveryHour: row.delivery_hour,
    deliveryMinute: row.delivery_minute, timezone: row.timezone, recipients: row.recipients ?? [],
    format: row.format, deliveryMode: row.delivery_mode, enabled: row.enabled,
    nextRunAt: row.next_run_at, lastRunAt: row.last_run_at, lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at, lastError: row.last_error, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export function registerScheduledReportRoutes(app, {
  postgres, redisUrl, requireViewer, requireAdmin, writeAudit,
  QueueClass = Queue, connectionFactory = (url, options) => new Redis(url, options)
}) {
  const queueConnection = connectionFactory(redisUrl, { maxRetriesPerRequest: 3, enableReadyCheck: true });
  const queue = new QueueClass('report-exports', { connection: queueConnection });
  const base = '/api/v1/customer/workspaces/:workspaceId/report-schedules';
  let timer = null;

  async function runDueSchedules(now = new Date()) {
    const due = await postgres.query(
      `SELECT s.*, v.name AS saved_view_name, v.date_preset, v.filters, v.user_id AS view_user_id
       FROM scheduled_report_schedules s
       JOIN saved_reporting_views v ON v.id = s.saved_view_id AND v.workspace_id = s.workspace_id
       WHERE s.enabled = TRUE AND s.next_run_at <= $1
       ORDER BY s.next_run_at
       LIMIT 50`,
      [now]
    );
    let queued = 0;
    for (const schedule of due.rows) {
      const client = await postgres.connect();
      try {
        await client.query('BEGIN');
        const locked = await client.query(
          `SELECT * FROM scheduled_report_schedules WHERE id = $1 AND enabled = TRUE AND next_run_at <= $2 FOR UPDATE SKIP LOCKED`,
          [schedule.id, now]
        );
        if (locked.rowCount === 0) { await client.query('ROLLBACK'); continue; }
        const scheduledFor = new Date(locked.rows[0].next_run_at);
        const execution = await client.query(
          `INSERT INTO scheduled_report_executions(schedule_id, workspace_id, scheduled_for, status)
           VALUES ($1, $2, $3, 'queued') ON CONFLICT (schedule_id, scheduled_for) DO NOTHING RETURNING id`,
          [schedule.id, schedule.workspace_id, scheduledFor]
        );
        const nextRunAt = computeNextRun({
          frequency: schedule.frequency, timezone: schedule.timezone,
          deliveryHour: schedule.delivery_hour, deliveryMinute: schedule.delivery_minute,
          weekday: schedule.weekday, monthday: schedule.monthday
        }, new Date(scheduledFor.getTime() + 1_000));
        if (execution.rowCount === 0) {
          await client.query('UPDATE scheduled_report_schedules SET next_run_at = $2, updated_at = NOW() WHERE id = $1', [schedule.id, nextRunAt]);
          await client.query('COMMIT');
          continue;
        }
        const filters = resolveDatePreset(schedule.date_preset, schedule.filters ?? {}, now);
        const exportResult = await client.query(
          `INSERT INTO report_export_jobs(workspace_id, requested_by_user_id, saved_view_id, format, filters, view_name)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING id`,
          [schedule.workspace_id, schedule.created_by_user_id, schedule.saved_view_id, schedule.format, JSON.stringify(filters), schedule.saved_view_name]
        );
        const exportJobId = exportResult.rows[0].id;
        await client.query(
          `UPDATE scheduled_report_executions SET export_job_id = $2, status = 'exporting' WHERE id = $1`,
          [execution.rows[0].id, exportJobId]
        );
        await client.query(
          `UPDATE scheduled_report_schedules SET last_run_at = $2, next_run_at = $3, last_error = NULL, updated_at = NOW() WHERE id = $1`,
          [schedule.id, scheduledFor, nextRunAt]
        );
        await client.query('COMMIT');
        try {
          await queue.add(`scheduled-${schedule.format}`, {
            exportJobId, workspaceId: schedule.workspace_id, userId: schedule.created_by_user_id
          }, { jobId: `export-${String(exportJobId).replaceAll('-', '')}` });
          queued += 1;
        } catch (error) {
          await postgres.query(
            `UPDATE scheduled_report_executions SET status = 'failed', error = 'Export queue is unavailable.', completed_at = NOW() WHERE id = $1`,
            [execution.rows[0].id]
          );
          await postgres.query(
            `UPDATE scheduled_report_schedules SET last_failure_at = NOW(), last_error = 'Export queue is unavailable.', updated_at = NOW() WHERE id = $1`,
            [schedule.id]
          );
        }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        app.log.error({ scheduleId: schedule.id, error }, 'Scheduled report orchestration failed');
      } finally {
        client.release();
      }
    }
    return { inspected: due.rowCount, queued };
  }

  app.get(base, { preHandler: requireViewer }, async (request) => {
    const result = await postgres.query(
      `SELECT s.*, v.name AS saved_view_name FROM scheduled_report_schedules s
       JOIN saved_reporting_views v ON v.id = s.saved_view_id
       WHERE s.workspace_id = $1 ORDER BY s.updated_at DESC LIMIT 100`,
      [request.params.workspaceId]
    );
    return { results: result.rows.map(serialize) };
  });

  app.post(base, { preHandler: requireAdmin }, async (request, reply) => {
    const input = normalizeScheduleRequest(request.body ?? {});
    const view = await postgres.query(
      `SELECT id FROM saved_reporting_views WHERE id = $1 AND workspace_id = $2 AND user_id = $3 LIMIT 1`,
      [input.savedViewId, request.params.workspaceId, request.customer.user.id]
    );
    if (view.rowCount === 0) throw scheduleError('Saved reporting view not found.', 'SAVED_VIEW_NOT_FOUND', 404);
    const result = await postgres.query(
      `INSERT INTO scheduled_report_schedules(
         workspace_id, created_by_user_id, saved_view_id, name, frequency, weekday, monthday,
         delivery_hour, delivery_minute, timezone, recipients, format, delivery_mode, enabled, next_run_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15)
       RETURNING *`,
      [request.params.workspaceId, request.customer.user.id, input.savedViewId, input.name, input.frequency,
       input.weekday, input.monthday, input.deliveryHour, input.deliveryMinute, input.timezone,
       JSON.stringify(input.recipients), input.format, input.deliveryMode, input.enabled, input.nextRunAt]
    );
    await writeAudit(request, { workspaceId: request.params.workspaceId, actorUserId: request.customer.user.id,
      action: 'report_schedule.created', targetType: 'report_schedule', targetId: result.rows[0].id,
      metadata: { frequency: input.frequency, format: input.format, recipientCount: input.recipients.length } });
    return reply.code(201).send(serialize(result.rows[0]));
  });

  app.patch(`${base}/:scheduleId`, { preHandler: requireAdmin }, async (request) => {
    const scheduleId = normalizeUuid(request.params.scheduleId, 'Schedule ID');
    const input = normalizeScheduleRequest(request.body ?? {});
    const result = await postgres.query(
      `UPDATE scheduled_report_schedules SET saved_view_id=$3,name=$4,frequency=$5,weekday=$6,monthday=$7,
       delivery_hour=$8,delivery_minute=$9,timezone=$10,recipients=$11::jsonb,format=$12,delivery_mode=$13,
       enabled=$14,next_run_at=$15,updated_at=NOW()
       WHERE id=$1 AND workspace_id=$2 RETURNING *`,
      [scheduleId, request.params.workspaceId, input.savedViewId, input.name, input.frequency, input.weekday,
       input.monthday, input.deliveryHour, input.deliveryMinute, input.timezone, JSON.stringify(input.recipients),
       input.format, input.deliveryMode, input.enabled, input.nextRunAt]
    );
    if (result.rowCount === 0) throw scheduleError('Report schedule not found.', 'REPORT_SCHEDULE_NOT_FOUND', 404);
    await writeAudit(request, { workspaceId: request.params.workspaceId, actorUserId: request.customer.user.id,
      action: 'report_schedule.updated', targetType: 'report_schedule', targetId: scheduleId });
    return serialize(result.rows[0]);
  });

  app.delete(`${base}/:scheduleId`, { preHandler: requireAdmin }, async (request, reply) => {
    const scheduleId = normalizeUuid(request.params.scheduleId, 'Schedule ID');
    const result = await postgres.query('DELETE FROM scheduled_report_schedules WHERE id=$1 AND workspace_id=$2 RETURNING id', [scheduleId, request.params.workspaceId]);
    if (result.rowCount === 0) throw scheduleError('Report schedule not found.', 'REPORT_SCHEDULE_NOT_FOUND', 404);
    await writeAudit(request, { workspaceId: request.params.workspaceId, actorUserId: request.customer.user.id,
      action: 'report_schedule.deleted', targetType: 'report_schedule', targetId: scheduleId });
    return reply.code(204).send();
  });

  app.get(`${base}/:scheduleId/executions`, { preHandler: requireViewer }, async (request) => {
    const scheduleId = normalizeUuid(request.params.scheduleId, 'Schedule ID');
    const result = await postgres.query(
      `SELECT e.id,e.scheduled_for,e.status,e.delivery_status,e.error,e.created_at,e.completed_at,
              x.id AS export_job_id,x.status AS export_status,x.file_name,x.expires_at
       FROM scheduled_report_executions e
       LEFT JOIN report_export_jobs x ON x.id=e.export_job_id
       WHERE e.schedule_id=$1 AND e.workspace_id=$2 ORDER BY e.created_at DESC LIMIT 50`,
      [scheduleId, request.params.workspaceId]
    );
    return { results: result.rows };
  });

  return {
    async start() {
      await runDueSchedules();
      timer = setInterval(() => void runDueSchedules().catch((error) => app.log.error({ error }, 'Scheduled reports poll failed')), 60_000);
    },
    async close() {
      if (timer) clearInterval(timer);
      await Promise.allSettled([queue.close(), queueConnection.quit()]);
    },
    runDueSchedules
  };
}
