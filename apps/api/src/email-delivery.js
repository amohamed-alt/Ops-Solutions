const MIGRATION_VERSION = 6;
const MIGRATION_LOCK = 812341236;
const MAX_ATTEMPTS = 5;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const PROVIDERS = new Set(['disabled', 'resend', 'postmark']);
const DEFAULT_LOCALE = 'en-US';
const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_CURRENCY = 'USD';
const DEFAULT_ACCENT = '#087f68';

const SCHEMA_SQL = `
  ALTER TABLE scheduled_report_executions
    ADD COLUMN IF NOT EXISTS delivery_attempt_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS next_delivery_attempt_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS delivery_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
    ADD COLUMN IF NOT EXISTS delivery_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

  CREATE INDEX IF NOT EXISTS scheduled_report_executions_delivery_due_idx
    ON scheduled_report_executions(status, next_delivery_attempt_at, created_at)
    WHERE status IN ('exporting', 'ready_for_delivery');
`;

export const EMAIL_DELIVERY_ROLLBACK_SQL = `
  DROP INDEX IF EXISTS scheduled_report_executions_delivery_due_idx;
  ALTER TABLE scheduled_report_executions
    DROP COLUMN IF EXISTS delivery_attempt_count,
    DROP COLUMN IF EXISTS next_delivery_attempt_at,
    DROP COLUMN IF EXISTS delivery_started_at,
    DROP COLUMN IF EXISTS provider_message_id,
    DROP COLUMN IF EXISTS delivery_metadata;
`;

function safeText(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function escapeHtml(value) {
  return safeText(value, 10_000)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function configuredProvider(env = process.env) {
  const name = safeText(env.EMAIL_PROVIDER || 'disabled', 30).toLowerCase();
  return PROVIDERS.has(name) ? name : 'disabled';
}

export function getEmailDeliveryConfiguration(env = process.env) {
  const provider = configuredProvider(env);
  const fromEmail = safeText(env.EMAIL_FROM_ADDRESS, 320);
  const fromName = safeText(env.EMAIL_FROM_NAME || 'Ops Intelligence', 120);
  const apiKey = provider === 'resend'
    ? safeText(env.RESEND_API_KEY, 500)
    : provider === 'postmark'
      ? safeText(env.POSTMARK_SERVER_TOKEN, 500)
      : '';
  const missing = [];
  if (provider === 'disabled') missing.push('EMAIL_PROVIDER');
  if (!fromEmail) missing.push('EMAIL_FROM_ADDRESS');
  if (provider !== 'disabled' && !apiKey) {
    missing.push(provider === 'resend' ? 'RESEND_API_KEY' : 'POSTMARK_SERVER_TOKEN');
  }
  return {
    provider,
    fromEmail,
    fromName,
    apiKey,
    configured: provider !== 'disabled' && missing.length === 0,
    missing
  };
}

export function classifyDeliveryError(status, body = '') {
  const code = Number(status || 0);
  const retryable = code === 0 || code === 408 || code === 409 || code === 425 || code === 429 || code >= 500;
  return {
    retryable,
    category: retryable ? 'temporary_provider_failure' : 'permanent_provider_rejection',
    message: safeText(body || `Email provider returned HTTP ${code || 'network error'}.`, 1000)
  };
}

export function retryDelayMs(attempt) {
  const minutes = Math.min(6 * 60, 2 ** Math.max(0, Number(attempt) - 1) * 5);
  return minutes * 60_000;
}

export async function ensureEmailDeliverySchema(postgres) {
  const client = await postgres.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${MIGRATION_LOCK})`);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    const existing = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [MIGRATION_VERSION]);
    if (existing.rowCount > 0) return { applied: false, version: MIGRATION_VERSION };
    await client.query('BEGIN');
    try {
      await client.query(SCHEMA_SQL);
      await client.query('INSERT INTO schema_migrations(version, name) VALUES ($1, $2)', [MIGRATION_VERSION, 'scheduled_report_email_delivery']);
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

function validLocale(value) {
  const candidate = safeText(value, 40) || DEFAULT_LOCALE;
  try {
    new Intl.NumberFormat(candidate).format(1);
    return candidate;
  } catch {
    return DEFAULT_LOCALE;
  }
}

function validTimezone(value) {
  const candidate = safeText(value, 80) || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat(DEFAULT_LOCALE, { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function validCurrency(value) {
  const candidate = safeText(value, 3).toUpperCase();
  return /^[A-Z]{3}$/.test(candidate) ? candidate : DEFAULT_CURRENCY;
}

function validAccent(value) {
  const candidate = safeText(value, 7);
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : DEFAULT_ACCENT;
}

function safeLogoUrl(value) {
  const candidate = safeText(value, 1000);
  if (!candidate) return '';
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function resolveScheduledReportBranding(row) {
  return {
    companyName: safeText(row.company_name || row.workspace_name, 120) || 'Your company',
    locale: validLocale(row.locale),
    timezone: validTimezone(row.timezone),
    currency: validCurrency(row.currency),
    accentColor: validAccent(row.accent_color),
    logoUrl: safeLogoUrl(row.logo_url)
  };
}

function localizedDate(value, context, options = {}) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat(context.locale, {
    timeZone: context.timezone,
    dateStyle: options.dateStyle || 'medium',
    ...(options.includeTime === false ? {} : { timeStyle: options.timeStyle || 'short' })
  }).format(date);
}

function reportPeriod(filters = {}, context) {
  if (!filters.from || !filters.to) return 'the selected reporting period';
  const from = localizedDate(`${filters.from}T12:00:00Z`, context, { includeTime: false });
  const to = localizedDate(`${filters.to}T12:00:00Z`, context, { includeTime: false });
  return `${from} – ${to}`;
}

export function buildScheduledReportMessage(row, appUrl) {
  const context = resolveScheduledReportBranding(row);
  const workspace = context.companyName;
  const view = safeText(row.view_name || row.schedule_name, 120) || 'Revenue report';
  const period = reportPeriod(row.filters || {}, context);
  const generatedAt = localizedDate(row.export_completed_at || Date.now(), context);
  const settingsUrl = `${String(appUrl || '').replace(/\/$/, '')}/settings/reports?workspaceId=${encodeURIComponent(row.workspace_id)}`;
  const subject = `${workspace} · ${view}`;
  const deliveryCopy = row.delivery_mode === 'attachment'
    ? 'The requested report is attached to this email.'
    : 'Your scheduled report has been generated successfully.';
  const text = [
    `${view} for ${workspace}`,
    `Reporting period: ${period}`,
    `Generated: ${generatedAt} (${context.timezone})`,
    `Reporting context: ${context.currency} · ${context.locale}`,
    deliveryCopy,
    `Manage this schedule: ${settingsUrl}`
  ].join('\n\n');
  const logo = context.logoUrl
    ? `<img src="${escapeHtml(context.logoUrl)}" alt="${escapeHtml(workspace)}" style="display:block;max-width:160px;max-height:56px;object-fit:contain;margin:0 0 18px"/>`
    : `<div style="width:42px;height:42px;border-radius:12px;background:${context.accentColor};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;margin:0 0 18px">${escapeHtml(workspace.slice(0, 2).toUpperCase())}</div>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f7f6;font-family:Arial,sans-serif;color:#17332f"><div style="max-width:640px;margin:0 auto;padding:32px 16px"><div style="background:#fff;border:1px solid #dce8e5;border-radius:18px;padding:28px">${logo}<div style="font-size:12px;letter-spacing:.12em;color:#52746e;font-weight:700">${escapeHtml(workspace.toUpperCase())}</div><h1 style="font-size:25px;margin:12px 0 8px">${escapeHtml(view)}</h1><p style="margin:0 0 22px;color:#52746e">${escapeHtml(period)}</p><div style="background:#f2f8f6;border-left:4px solid ${context.accentColor};border-radius:12px;padding:16px"><strong>Report ready</strong><p style="margin:7px 0 0;color:#52746e">${escapeHtml(deliveryCopy)}</p></div><table role="presentation" style="width:100%;margin-top:22px;border-collapse:collapse;font-size:13px;color:#52746e"><tr><td style="padding:6px 0">Generated</td><td style="padding:6px 0;text-align:right;color:#17332f;font-weight:700">${escapeHtml(generatedAt)}</td></tr><tr><td style="padding:6px 0">Timezone</td><td style="padding:6px 0;text-align:right;color:#17332f;font-weight:700">${escapeHtml(context.timezone)}</td></tr><tr><td style="padding:6px 0">Currency</td><td style="padding:6px 0;text-align:right;color:#17332f;font-weight:700">${escapeHtml(context.currency)}</td></tr></table><a href="${escapeHtml(settingsUrl)}" style="display:inline-block;margin-top:20px;color:${context.accentColor};font-weight:700">Manage scheduled reports</a></div></div></body></html>`;
  return { subject, text, html, context };
}

async function sendResend(config, payload, fetchImpl) {
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
      'idempotency-key': payload.idempotencyKey
    },
    body: JSON.stringify({
      from: config.fromName ? `${config.fromName} <${config.fromEmail}>` : config.fromEmail,
      to: payload.recipients,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      attachments: payload.attachment ? [{ filename: payload.attachment.fileName, content: payload.attachment.content.toString('base64') }] : undefined
    }),
    signal: AbortSignal.timeout(20_000)
  });
  const body = await response.text();
  if (!response.ok) {
    const classified = classifyDeliveryError(response.status, body);
    const error = new Error(classified.message);
    Object.assign(error, classified, { statusCode: response.status });
    throw error;
  }
  const result = JSON.parse(body || '{}');
  return { providerMessageId: safeText(result.id, 300) || null };
}

async function sendPostmark(config, payload, fetchImpl) {
  const response = await fetchImpl('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'x-postmark-server-token': config.apiKey,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      From: config.fromName ? `${config.fromName} <${config.fromEmail}>` : config.fromEmail,
      To: payload.recipients.join(','),
      Subject: payload.subject,
      TextBody: payload.text,
      HtmlBody: payload.html,
      MessageStream: 'outbound',
      Metadata: { execution_id: payload.idempotencyKey },
      Attachments: payload.attachment ? [{ Name: payload.attachment.fileName, Content: payload.attachment.content.toString('base64'), ContentType: payload.attachment.contentType }] : undefined
    }),
    signal: AbortSignal.timeout(20_000)
  });
  const body = await response.text();
  if (!response.ok) {
    const classified = classifyDeliveryError(response.status, body);
    const error = new Error(classified.message);
    Object.assign(error, classified, { statusCode: response.status });
    throw error;
  }
  const result = JSON.parse(body || '{}');
  return { providerMessageId: safeText(result.MessageID, 300) || null };
}

export async function sendEmail(config, payload, fetchImpl = fetch) {
  if (!config.configured) {
    const error = new Error('Email provider is not configured.');
    error.category = 'provider_not_configured';
    error.retryable = false;
    throw error;
  }
  if (config.provider === 'resend') return sendResend(config, payload, fetchImpl);
  if (config.provider === 'postmark') return sendPostmark(config, payload, fetchImpl);
  throw new Error('Unsupported email provider.');
}

async function promoteCompletedExports(postgres) {
  const result = await postgres.query(`
    UPDATE scheduled_report_executions e
    SET status = CASE WHEN x.status = 'completed' THEN 'ready_for_delivery' ELSE 'failed' END,
        delivery_status = CASE WHEN x.status = 'completed' THEN 'pending' ELSE 'export_failed' END,
        error = CASE WHEN x.status = 'failed' THEN COALESCE(x.error, 'Report export failed.') ELSE e.error END,
        next_delivery_attempt_at = CASE WHEN x.status = 'completed' THEN NOW() ELSE NULL END,
        completed_at = CASE WHEN x.status = 'failed' THEN NOW() ELSE e.completed_at END
    FROM report_export_jobs x
    WHERE e.export_job_id = x.id
      AND e.status = 'exporting'
      AND x.status IN ('completed', 'failed')
    RETURNING e.id
  `);
  return result.rowCount;
}

async function claimExecution(postgres) {
  const client = await postgres.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      SELECT e.id, e.workspace_id, e.delivery_attempt_count, e.export_job_id,
             s.id AS schedule_id, s.name AS schedule_name, s.recipients, s.delivery_mode,
             w.name AS workspace_name, x.view_name, x.filters, x.file_name, x.content_type,
             x.file_size_bytes, x.artifact, x.completed_at AS export_completed_at,
             p.company_name, p.currency, p.timezone, p.locale, p.accent_color, p.logo_url
      FROM scheduled_report_executions e
      JOIN scheduled_report_schedules s ON s.id = e.schedule_id AND s.workspace_id = e.workspace_id
      JOIN workspaces w ON w.id = e.workspace_id
      JOIN report_export_jobs x ON x.id = e.export_job_id AND x.workspace_id = e.workspace_id
      LEFT JOIN workspace_preferences p ON p.workspace_id = e.workspace_id
      WHERE e.status = 'ready_for_delivery'
        AND COALESCE(e.next_delivery_attempt_at, NOW()) <= NOW()
        AND e.delivery_attempt_count < $1
      ORDER BY e.next_delivery_attempt_at NULLS FIRST, e.created_at
      LIMIT 1
      FOR UPDATE OF e SKIP LOCKED
    `, [MAX_ATTEMPTS]);
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const row = result.rows[0];
    await client.query(`UPDATE scheduled_report_executions
      SET delivery_status='sending', delivery_started_at=NOW(), delivery_attempt_count=delivery_attempt_count+1
      WHERE id=$1`, [row.id]);
    await client.query('COMMIT');
    return { ...row, delivery_attempt_count: Number(row.delivery_attempt_count) + 1 };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function completeDelivery(postgres, row, result, provider, context) {
  await postgres.query(`UPDATE scheduled_report_executions
    SET status='delivered',delivery_status='delivered',provider_message_id=$2,
        delivery_metadata=$3::jsonb,error=NULL,completed_at=NOW(),next_delivery_attempt_at=NULL
    WHERE id=$1 AND workspace_id=$4`, [row.id, result.providerMessageId, JSON.stringify({
      provider,
      locale: context.locale,
      timezone: context.timezone,
      currency: context.currency,
      branded: Boolean(context.logoUrl || context.accentColor !== DEFAULT_ACCENT)
    }), row.workspace_id]);
  await postgres.query(`UPDATE scheduled_report_schedules
    SET last_success_at=NOW(),last_error=NULL,updated_at=NOW() WHERE id=$1 AND workspace_id=$2`, [row.schedule_id, row.workspace_id]);
}

async function failDelivery(postgres, row, error, providerConfigured) {
  const attempt = Number(row.delivery_attempt_count || 1);
  const retryable = providerConfigured && error.retryable !== false && attempt < MAX_ATTEMPTS;
  const message = safeText(error.message || 'Email delivery failed.', 1000);
  const nextAttempt = retryable ? new Date(Date.now() + retryDelayMs(attempt)) : null;
  await postgres.query(`UPDATE scheduled_report_executions
    SET status=$2,delivery_status=$3,error=$4,next_delivery_attempt_at=$5,
        completed_at=CASE WHEN $2='failed' THEN NOW() ELSE NULL END
    WHERE id=$1 AND workspace_id=$6`, [row.id, retryable ? 'ready_for_delivery' : 'failed', error.category || 'delivery_failed', message, nextAttempt, row.workspace_id]);
  await postgres.query(`UPDATE scheduled_report_schedules
    SET last_failure_at=NOW(),last_error=$3,updated_at=NOW() WHERE id=$1 AND workspace_id=$2`, [row.schedule_id, row.workspace_id, message]);
}

export async function processScheduledReportDeliveries(postgres, {
  env = process.env,
  fetchImpl = fetch,
  appUrl = env.APP_URL || 'http://localhost:3210',
  maxDeliveries = 10
} = {}) {
  await promoteCompletedExports(postgres);
  const config = getEmailDeliveryConfiguration(env);
  let delivered = 0;
  let failed = 0;
  for (let index = 0; index < maxDeliveries; index += 1) {
    const row = await claimExecution(postgres);
    if (!row) break;
    try {
      if (!Array.isArray(row.recipients) || row.recipients.length === 0) throw Object.assign(new Error('Schedule has no valid recipients.'), { retryable: false, category: 'invalid_recipients' });
      const message = buildScheduledReportMessage(row, appUrl);
      const attachment = row.delivery_mode === 'attachment' ? {
        fileName: safeText(row.file_name, 240) || 'report.xlsx',
        contentType: safeText(row.content_type, 200) || 'application/octet-stream',
        content: row.artifact
      } : null;
      if (attachment && (!Buffer.isBuffer(attachment.content) || attachment.content.length > MAX_ATTACHMENT_BYTES)) {
        throw Object.assign(new Error('Report attachment is unavailable or exceeds the 5 MiB delivery limit.'), { retryable: false, category: 'invalid_attachment' });
      }
      const result = await sendEmail(config, {
        ...message,
        recipients: row.recipients,
        attachment,
        idempotencyKey: `scheduled-report-${String(row.id).replaceAll('-', '')}`
      }, fetchImpl);
      await completeDelivery(postgres, row, result, config.provider, message.context);
      delivered += 1;
    } catch (error) {
      await failDelivery(postgres, row, error, config.configured);
      failed += 1;
    }
  }
  return { delivered, failed, provider: config.provider, configured: config.configured };
}

export function startEmailDeliveryLoop(postgres, options = {}) {
  let stopped = false;
  let timer = null;
  const intervalMs = Math.max(30_000, Number(options.intervalMs || process.env.EMAIL_DELIVERY_POLL_INTERVAL_MS || 60_000));
  async function tick() {
    if (stopped) return;
    try {
      await ensureEmailDeliverySchema(postgres);
      await processScheduledReportDeliveries(postgres, options);
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'scheduled_report_delivery_failed', message: safeText(error.message, 1000) }));
    } finally {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  }
  timer = setTimeout(tick, 5_000);
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
