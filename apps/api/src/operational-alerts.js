import { recordBillingUsage } from './billing.js';
import { getEmailDeliveryConfiguration, sendEmail } from './email-delivery.js';
import { buildRevenueReportingPack } from './revenue-reporting.js';
import { buildRetentionBudgetReport } from './retention-budget.js';

const MIGRATION_VERSION = 32;
const MIGRATION_LOCK = 812341262;
const RULE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const METRICS = new Set([
  'overdue_tasks',
  'deals_at_risk',
  'no_show_rate',
  'data_quality_score',
  'sync_stale_hours',
  'delayed_renewals',
  'remaining_collection',
  'open_pipeline'
]);
const COMPARATORS = new Set(['gt', 'gte', 'lt', 'lte', 'eq']);
const MAX_RULES_PER_WORKSPACE = 50;
const MAX_RECIPIENTS = 20;
const MAX_BATCH = 25;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS operational_alert_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    metric TEXT NOT NULL CHECK (metric IN ('overdue_tasks','deals_at_risk','no_show_rate','data_quality_score','sync_stale_hours','delayed_renewals','remaining_collection','open_pipeline')),
    comparator TEXT NOT NULL CHECK (comparator IN ('gt','gte','lt','lte','eq')),
    threshold NUMERIC(18,4) NOT NULL,
    recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
    evaluation_interval_minutes INTEGER NOT NULL DEFAULT 15 CHECK (evaluation_interval_minutes BETWEEN 5 AND 1440),
    cooldown_minutes INTEGER NOT NULL DEFAULT 120 CHECK (cooldown_minutes BETWEEN 15 AND 10080),
    notify_on_recovery BOOLEAN NOT NULL DEFAULT TRUE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_state TEXT NOT NULL DEFAULT 'unknown' CHECK (last_state IN ('unknown','healthy','breached')),
    last_value NUMERIC(18,4),
    last_evaluated_at TIMESTAMPTZ,
    last_triggered_at TIMESTAMPTZ,
    next_evaluation_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS operational_alert_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    rule_id UUID NOT NULL REFERENCES operational_alert_rules(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('triggered','recovered','delivery_failed')),
    metric TEXT NOT NULL,
    metric_value NUMERIC(18,4) NOT NULL,
    threshold NUMERIC(18,4) NOT NULL,
    comparator TEXT NOT NULL,
    recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
    delivery_status TEXT NOT NULL DEFAULT 'pending',
    provider TEXT,
    provider_message_id TEXT,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ
  );

  CREATE INDEX IF NOT EXISTS operational_alert_rules_due_idx
    ON operational_alert_rules(next_evaluation_at, workspace_id)
    WHERE enabled = TRUE;
  CREATE INDEX IF NOT EXISTS operational_alert_events_workspace_idx
    ON operational_alert_events(workspace_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS operational_alert_events_rule_idx
    ON operational_alert_events(rule_id, created_at DESC);
`;

function alertError(message, category = 'ALERT_RULE_INVALID', statusCode = 400) {
  const error = new Error(message);
  error.category = category;
  error.statusCode = statusCode;
  return error;
}

function safeText(value, max = 500) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function escapeHtml(value) {
  return safeText(value, 10_000)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function requireManager(request) {
  if (!['owner', 'admin'].includes(String(request.workspaceMembership?.role || ''))) {
    throw alertError('Admin or owner access is required.', 'WORKSPACE_ROLE_REQUIRED', 403);
  }
}

function normalizeRecipients(value) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(/[;,\s]+/);
  const recipients = [...new Set(source.map((item) => safeText(item, 320).toLowerCase()).filter(Boolean))];
  if (recipients.length < 1 || recipients.length > MAX_RECIPIENTS || recipients.some((email) => !EMAIL_PATTERN.test(email))) {
    throw alertError(`Provide between 1 and ${MAX_RECIPIENTS} valid email recipients.`);
  }
  return recipients;
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function normalizeRule(body = {}, { partial = false } = {}) {
  const result = {};
  if (!partial || body.name !== undefined) {
    const name = safeText(body.name, 120);
    if (name.length < 2) throw alertError('Alert name must be between 2 and 120 characters.');
    result.name = name;
  }
  if (!partial || body.metric !== undefined) {
    const metric = safeText(body.metric, 80).toLowerCase();
    if (!METRICS.has(metric)) throw alertError('Unsupported operational alert metric.');
    result.metric = metric;
  }
  if (!partial || body.comparator !== undefined) {
    const comparator = safeText(body.comparator, 8).toLowerCase();
    if (!COMPARATORS.has(comparator)) throw alertError('Unsupported alert comparator.');
    result.comparator = comparator;
  }
  if (!partial || body.threshold !== undefined) {
    const threshold = Number(body.threshold);
    if (!Number.isFinite(threshold) || Math.abs(threshold) > 1_000_000_000_000) throw alertError('Alert threshold must be a finite number.');
    result.threshold = threshold;
  }
  if (!partial || body.recipients !== undefined) result.recipients = normalizeRecipients(body.recipients);
  if (!partial || body.evaluationIntervalMinutes !== undefined) {
    result.evaluationIntervalMinutes = boundedInteger(body.evaluationIntervalMinutes, 15, 5, 1440);
  }
  if (!partial || body.cooldownMinutes !== undefined) {
    result.cooldownMinutes = boundedInteger(body.cooldownMinutes, 120, 15, 10080);
  }
  if (!partial || body.notifyOnRecovery !== undefined) result.notifyOnRecovery = body.notifyOnRecovery !== false;
  if (!partial || body.enabled !== undefined) result.enabled = body.enabled !== false;
  return result;
}

function serializeRule(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    metric: row.metric,
    comparator: row.comparator,
    threshold: Number(row.threshold),
    recipients: row.recipients ?? [],
    evaluationIntervalMinutes: row.evaluation_interval_minutes,
    cooldownMinutes: row.cooldown_minutes,
    notifyOnRecovery: row.notify_on_recovery,
    enabled: row.enabled,
    lastState: row.last_state,
    lastValue: row.last_value === null ? null : Number(row.last_value),
    lastEvaluatedAt: row.last_evaluated_at,
    lastTriggeredAt: row.last_triggered_at,
    nextEvaluationAt: row.next_evaluation_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeEvent(row) {
  return {
    id: row.id,
    ruleId: row.rule_id,
    state: row.state,
    metric: row.metric,
    metricValue: Number(row.metric_value),
    threshold: Number(row.threshold),
    comparator: row.comparator,
    recipients: row.recipients ?? [],
    deliveryStatus: row.delivery_status,
    provider: row.provider,
    error: row.error,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at
  };
}

export async function ensureOperationalAlertSchema(postgres) {
  const client = await postgres.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${MIGRATION_LOCK})`);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    const existing = await client.query('SELECT 1 FROM schema_migrations WHERE version=$1', [MIGRATION_VERSION]);
    if (existing.rowCount > 0) return { applied: false, version: MIGRATION_VERSION };
    await client.query('BEGIN');
    try {
      await client.query(SCHEMA_SQL);
      await client.query('INSERT INTO schema_migrations(version,name) VALUES($1,$2)', [MIGRATION_VERSION, 'tenant_operational_alert_rules']);
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

function compare(value, comparator, threshold) {
  if (comparator === 'gt') return value > threshold;
  if (comparator === 'gte') return value >= threshold;
  if (comparator === 'lt') return value < threshold;
  if (comparator === 'lte') return value <= threshold;
  return Math.abs(value - threshold) < 0.0001;
}

async function metricSnapshot(postgres, workspaceId, cache) {
  if (cache.has(workspaceId)) return cache.get(workspaceId);
  const [revenue, retention, freshness] = await Promise.all([
    buildRevenueReportingPack(postgres, workspaceId, {}),
    buildRetentionBudgetReport(postgres, workspaceId, {}).catch(() => ({ configured: false, summary: {} })),
    postgres.query('SELECT MAX(synced_at) AS newest_sync FROM crm_records WHERE workspace_id=$1', [workspaceId])
  ]);
  const meetingOutcomes = revenue.outcomes?.meetings ?? [];
  const noShows = meetingOutcomes
    .filter((row) => /no[ _-]?show/i.test(String(row.key)))
    .reduce((sum, row) => sum + Number(row.value || 0), 0);
  const meetings = Number(revenue.overview?.meetings || 0);
  const newestSync = freshness.rows[0]?.newest_sync ? new Date(freshness.rows[0].newest_sync).getTime() : 0;
  const snapshot = {
    overdue_tasks: Number(revenue.overview?.overdueTasks ?? revenue.attention?.overdueTasks ?? 0),
    deals_at_risk: Number(revenue.overview?.dealsAtRisk ?? revenue.attention?.dealsAtRisk ?? 0),
    no_show_rate: meetings > 0 ? noShows / meetings * 100 : 0,
    data_quality_score: Number(revenue.dataQuality?.score || 0),
    sync_stale_hours: newestSync ? Math.max(0, (Date.now() - newestSync) / 3_600_000) : 999999,
    delayed_renewals: Number(retention.summary?.delayed || 0),
    remaining_collection: Number(retention.summary?.remainingCollection || 0),
    open_pipeline: Number(revenue.overview?.openPipeline || 0)
  };
  cache.set(workspaceId, snapshot);
  return snapshot;
}

async function claimDueRule(postgres, now = new Date()) {
  const client = await postgres.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT r.*,w.name AS workspace_name
       FROM operational_alert_rules r JOIN workspaces w ON w.id=r.workspace_id
       WHERE r.enabled=TRUE AND r.next_evaluation_at <= $1
       ORDER BY r.next_evaluation_at,r.created_at
       LIMIT 1 FOR UPDATE OF r SKIP LOCKED`,
      [now]
    );
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const row = result.rows[0];
    await client.query(
      `UPDATE operational_alert_rules SET next_evaluation_at=$2::timestamptz + (evaluation_interval_minutes || ' minutes')::interval,updated_at=NOW()
       WHERE id=$1`,
      [row.id, now]
    );
    await client.query('COMMIT');
    return row;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function metricLabel(metric) {
  return metric.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function comparatorLabel(value) {
  return ({ gt: 'above', gte: 'at or above', lt: 'below', lte: 'at or below', eq: 'equal to' })[value] || value;
}

function buildAlertMessage(rule, value, state, appUrl) {
  const recovered = state === 'recovered';
  const workspace = safeText(rule.workspace_name, 120) || 'Workspace';
  const name = safeText(rule.name, 120);
  const metric = metricLabel(rule.metric);
  const settingsUrl = `${String(appUrl || '').replace(/\/$/, '')}/settings/alerts?workspaceId=${encodeURIComponent(rule.workspace_id)}`;
  const subject = `${recovered ? 'Recovered' : 'Alert'} · ${workspace} · ${name}`;
  const summary = recovered
    ? `${metric} recovered to ${value.toFixed(2)}.`
    : `${metric} is ${value.toFixed(2)}, ${comparatorLabel(rule.comparator)} the threshold ${Number(rule.threshold).toFixed(2)}.`;
  const text = `${name} for ${workspace}\n\n${summary}\n\nManage alert rules: ${settingsUrl}`;
  const accent = recovered ? '#16805d' : '#b24a3f';
  const html = `<!doctype html><html><body style="margin:0;background:#f4f7f6;font-family:Arial,sans-serif;color:#17332f"><div style="max-width:620px;margin:0 auto;padding:32px 16px"><div style="background:#fff;border:1px solid #dce8e5;border-radius:18px;padding:28px"><div style="font-size:12px;letter-spacing:.12em;color:#52746e;font-weight:700">${escapeHtml(workspace.toUpperCase())}</div><h1 style="font-size:25px;margin:12px 0 8px">${escapeHtml(name)}</h1><div style="background:#f7f9f8;border-left:4px solid ${accent};border-radius:12px;padding:16px;margin-top:20px"><strong>${recovered ? 'Condition recovered' : 'Threshold breached'}</strong><p style="margin:7px 0 0;color:#52746e">${escapeHtml(summary)}</p></div><a href="${escapeHtml(settingsUrl)}" style="display:inline-block;margin-top:20px;color:#087f68;font-weight:700">Manage operational alerts</a></div></div></body></html>`;
  return { subject, text, html };
}

async function persistEvaluation(postgres, rule, value, breached, shouldNotify, state, now) {
  const event = shouldNotify
    ? await postgres.query(
      `INSERT INTO operational_alert_events(workspace_id,rule_id,state,metric,metric_value,threshold,comparator,recipients)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,
      [rule.workspace_id, rule.id, state, rule.metric, value, rule.threshold, rule.comparator, JSON.stringify(rule.recipients)]
    )
    : { rows: [] };
  await postgres.query(
    `UPDATE operational_alert_rules SET last_state=$3,last_value=$4,last_evaluated_at=$5,
       last_triggered_at=CASE WHEN $6 THEN $5 ELSE last_triggered_at END,updated_at=NOW()
     WHERE workspace_id=$1 AND id=$2`,
    [rule.workspace_id, rule.id, breached ? 'breached' : 'healthy', value, now, shouldNotify]
  );
  return event.rows[0] ?? null;
}

export async function evaluateOperationalAlertRule(postgres, rule, {
  env = process.env,
  fetchImpl = fetch,
  appUrl = env.APP_URL || 'http://localhost:3210',
  metricCache = new Map(),
  forceNotification = false,
  now = new Date()
} = {}) {
  const snapshot = await metricSnapshot(postgres, rule.workspace_id, metricCache);
  const value = Number(snapshot[rule.metric]);
  if (!Number.isFinite(value)) throw alertError(`Metric ${rule.metric} is unavailable.`, 'ALERT_METRIC_UNAVAILABLE', 409);
  const breached = compare(value, rule.comparator, Number(rule.threshold));
  const previousBreached = rule.last_state === 'breached';
  const cooldownElapsed = !rule.last_triggered_at || now.getTime() - new Date(rule.last_triggered_at).getTime() >= Number(rule.cooldown_minutes) * 60_000;
  const recovered = previousBreached && !breached;
  const shouldNotify = forceNotification || (breached && (!previousBreached || cooldownElapsed)) || (recovered && rule.notify_on_recovery);
  const state = recovered ? 'recovered' : 'triggered';
  const event = await persistEvaluation(postgres, rule, value, breached, shouldNotify, state, now);
  if (!event) return { value, breached, notified: false, state: breached ? 'breached' : 'healthy' };

  const config = getEmailDeliveryConfiguration(env);
  try {
    const message = buildAlertMessage(rule, value, state, appUrl);
    const result = await sendEmail(config, {
      ...message,
      recipients: rule.recipients,
      attachment: null,
      idempotencyKey: `operational-alert-${String(event.id).replaceAll('-', '')}`
    }, fetchImpl);
    await postgres.query(
      `UPDATE operational_alert_events SET delivery_status='delivered',provider=$2,provider_message_id=$3,delivered_at=NOW(),error=NULL
       WHERE id=$1 AND workspace_id=$4`,
      [event.id, config.provider, result.providerMessageId, rule.workspace_id]
    );
    await recordBillingUsage(postgres, rule.workspace_id, 'alert_deliveries', 1);
    return { value, breached, notified: true, state, eventId: event.id, provider: config.provider };
  } catch (error) {
    await postgres.query(
      `UPDATE operational_alert_events SET state='delivery_failed',delivery_status=$2,provider=$3,error=$4
       WHERE id=$1 AND workspace_id=$5`,
      [event.id, error.category || 'delivery_failed', config.provider, safeText(error.message, 1000), rule.workspace_id]
    );
    return { value, breached, notified: false, state, eventId: event.id, error: safeText(error.message, 1000) };
  }
}

export async function evaluateDueOperationalAlerts(postgres, options = {}) {
  await ensureOperationalAlertSchema(postgres);
  const metricCache = new Map();
  let evaluated = 0;
  let notified = 0;
  let failed = 0;
  const maxRules = Math.max(1, Math.min(MAX_BATCH, Number(options.maxRules) || MAX_BATCH));
  for (let index = 0; index < maxRules; index += 1) {
    const rule = await claimDueRule(postgres, options.now || new Date());
    if (!rule) break;
    try {
      const result = await evaluateOperationalAlertRule(postgres, rule, { ...options, metricCache });
      evaluated += 1;
      if (result.notified) notified += 1;
      if (result.error) failed += 1;
    } catch (error) {
      failed += 1;
      await postgres.query(
        `UPDATE operational_alert_rules SET last_evaluated_at=NOW(),updated_at=NOW() WHERE workspace_id=$1 AND id=$2`,
        [rule.workspace_id, rule.id]
      ).catch(() => undefined);
    }
  }
  return { evaluated, notified, failed };
}

export function startOperationalAlertLoop(postgres, options = {}) {
  let stopped = false;
  let timer = null;
  const intervalMs = Math.max(60_000, Number(options.intervalMs || process.env.OPERATIONAL_ALERT_POLL_INTERVAL_MS || 300_000));
  async function tick() {
    if (stopped) return;
    try {
      await evaluateDueOperationalAlerts(postgres, options);
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'operational_alert_evaluation_failed', message: safeText(error.message, 1000) }));
    } finally {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  }
  timer = setTimeout(tick, 15_000);
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

export function registerOperationalAlertRoutes(app, { postgres, requireViewer, writeAudit }) {
  const base = '/api/v1/customer/workspaces/:workspaceId/alerts';

  app.get(base, { preHandler: requireViewer }, async (request) => {
    const [rules, events] = await Promise.all([
      postgres.query('SELECT * FROM operational_alert_rules WHERE workspace_id=$1 ORDER BY created_at DESC', [request.params.workspaceId]),
      postgres.query('SELECT * FROM operational_alert_events WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100', [request.params.workspaceId])
    ]);
    const delivery = getEmailDeliveryConfiguration(process.env);
    return {
      rules: rules.rows.map(serializeRule),
      events: events.rows.map(serializeEvent),
      delivery: { configured: delivery.configured, provider: delivery.provider },
      metricCatalog: [...METRICS]
    };
  });

  app.post(base, { preHandler: requireViewer }, async (request, reply) => {
    requireManager(request);
    const rule = normalizeRule(request.body ?? {});
    const count = await postgres.query('SELECT COUNT(*)::int AS count FROM operational_alert_rules WHERE workspace_id=$1', [request.params.workspaceId]);
    if (Number(count.rows[0]?.count || 0) >= MAX_RULES_PER_WORKSPACE) throw alertError(`A workspace can have up to ${MAX_RULES_PER_WORKSPACE} alert rules.`, 'ALERT_RULE_LIMIT_REACHED', 409);
    const result = await postgres.query(
      `INSERT INTO operational_alert_rules(workspace_id,name,metric,comparator,threshold,recipients,evaluation_interval_minutes,cooldown_minutes,notify_on_recovery,enabled,created_by_user_id)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11) RETURNING *`,
      [request.params.workspaceId, rule.name, rule.metric, rule.comparator, rule.threshold, JSON.stringify(rule.recipients), rule.evaluationIntervalMinutes, rule.cooldownMinutes, rule.notifyOnRecovery, rule.enabled, request.customer.user.id]
    );
    await writeAudit(request, { workspaceId: request.params.workspaceId, actorUserId: request.customer.user.id, action: 'operational_alert.created', targetType: 'operational_alert_rule', targetId: result.rows[0].id, metadata: { metric: rule.metric, comparator: rule.comparator, threshold: rule.threshold } });
    return reply.code(201).send(serializeRule(result.rows[0]));
  });

  app.patch(`${base}/:ruleId`, { preHandler: requireViewer }, async (request) => {
    requireManager(request);
    const ruleId = String(request.params.ruleId || '');
    if (!RULE_ID_PATTERN.test(ruleId)) throw alertError('Alert rule ID is invalid.');
    const patch = normalizeRule(request.body ?? {}, { partial: true });
    const existing = await postgres.query('SELECT * FROM operational_alert_rules WHERE workspace_id=$1 AND id=$2', [request.params.workspaceId, ruleId]);
    if (existing.rowCount === 0) throw alertError('Alert rule not found.', 'ALERT_RULE_NOT_FOUND', 404);
    const current = serializeRule(existing.rows[0]);
    const merged = {
      name: patch.name ?? current.name,
      metric: patch.metric ?? current.metric,
      comparator: patch.comparator ?? current.comparator,
      threshold: patch.threshold ?? current.threshold,
      recipients: patch.recipients ?? current.recipients,
      evaluationIntervalMinutes: patch.evaluationIntervalMinutes ?? current.evaluationIntervalMinutes,
      cooldownMinutes: patch.cooldownMinutes ?? current.cooldownMinutes,
      notifyOnRecovery: patch.notifyOnRecovery ?? current.notifyOnRecovery,
      enabled: patch.enabled ?? current.enabled
    };
    const result = await postgres.query(
      `UPDATE operational_alert_rules SET name=$3,metric=$4,comparator=$5,threshold=$6,recipients=$7::jsonb,
       evaluation_interval_minutes=$8,cooldown_minutes=$9,notify_on_recovery=$10,enabled=$11,
       next_evaluation_at=LEAST(next_evaluation_at,NOW()),updated_at=NOW()
       WHERE workspace_id=$1 AND id=$2 RETURNING *`,
      [request.params.workspaceId, ruleId, merged.name, merged.metric, merged.comparator, merged.threshold, JSON.stringify(merged.recipients), merged.evaluationIntervalMinutes, merged.cooldownMinutes, merged.notifyOnRecovery, merged.enabled]
    );
    await writeAudit(request, { workspaceId: request.params.workspaceId, actorUserId: request.customer.user.id, action: 'operational_alert.updated', targetType: 'operational_alert_rule', targetId: ruleId, metadata: { metric: merged.metric, enabled: merged.enabled } });
    return serializeRule(result.rows[0]);
  });

  app.delete(`${base}/:ruleId`, { preHandler: requireViewer }, async (request, reply) => {
    requireManager(request);
    const ruleId = String(request.params.ruleId || '');
    if (!RULE_ID_PATTERN.test(ruleId)) throw alertError('Alert rule ID is invalid.');
    const result = await postgres.query('DELETE FROM operational_alert_rules WHERE workspace_id=$1 AND id=$2 RETURNING id', [request.params.workspaceId, ruleId]);
    if (result.rowCount === 0) throw alertError('Alert rule not found.', 'ALERT_RULE_NOT_FOUND', 404);
    await writeAudit(request, { workspaceId: request.params.workspaceId, actorUserId: request.customer.user.id, action: 'operational_alert.deleted', targetType: 'operational_alert_rule', targetId: ruleId });
    return reply.code(204).send();
  });

  app.post(`${base}/:ruleId/test`, { preHandler: requireViewer }, async (request) => {
    requireManager(request);
    const ruleId = String(request.params.ruleId || '');
    if (!RULE_ID_PATTERN.test(ruleId)) throw alertError('Alert rule ID is invalid.');
    const result = await postgres.query(
      `SELECT r.*,w.name AS workspace_name FROM operational_alert_rules r JOIN workspaces w ON w.id=r.workspace_id
       WHERE r.workspace_id=$1 AND r.id=$2`,
      [request.params.workspaceId, ruleId]
    );
    if (result.rowCount === 0) throw alertError('Alert rule not found.', 'ALERT_RULE_NOT_FOUND', 404);
    const evaluation = await evaluateOperationalAlertRule(postgres, result.rows[0], { forceNotification: true });
    await writeAudit(request, { workspaceId: request.params.workspaceId, actorUserId: request.customer.user.id, action: 'operational_alert.tested', targetType: 'operational_alert_rule', targetId: ruleId, metadata: { notified: evaluation.notified, value: evaluation.value } });
    return evaluation;
  });
}
