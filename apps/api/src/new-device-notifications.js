import { getEmailDeliveryConfiguration, sendEmail } from './email-delivery.js';

const SCHEMA_LOCK = 812341244;
const MAX_ATTEMPTS = 5;
const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_LOOKBACK_MINUTES = 15;

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

function browserLabel(userAgent) {
  const value = safeText(userAgent, 500);
  if (!value) return 'Unknown browser';
  if (/Edg\//i.test(value)) return 'Microsoft Edge';
  if (/OPR\//i.test(value)) return 'Opera';
  if (/Chrome\//i.test(value)) return 'Google Chrome';
  if (/Firefox\//i.test(value)) return 'Mozilla Firefox';
  if (/Safari\//i.test(value) && !/Chrome\//i.test(value)) return 'Safari';
  return 'Unrecognized browser';
}

function deviceLabel(userAgent) {
  const value = safeText(userAgent, 500);
  if (/iPhone|iPad|iPod/i.test(value)) return 'Apple mobile device';
  if (/Android/i.test(value)) return 'Android device';
  if (/Windows/i.test(value)) return 'Windows computer';
  if (/Macintosh|Mac OS X/i.test(value)) return 'Mac computer';
  if (/Linux/i.test(value)) return 'Linux computer';
  return 'Unknown device';
}

function retryDelayMs(attempt) {
  return Math.min(6 * 60 * 60_000, 5 * 60_000 * (2 ** Math.max(0, Number(attempt) - 1)));
}

export async function ensureNewDeviceNotificationSchema(postgres) {
  const client = await postgres.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${SCHEMA_LOCK})`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS account_security_notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        session_token_hash CHAR(64) NOT NULL,
        notification_type TEXT NOT NULL DEFAULT 'new_device_login',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'delivered', 'failed')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        provider_message_id TEXT,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        delivered_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, session_token_hash, notification_type)
      );
      CREATE INDEX IF NOT EXISTS account_security_notifications_due_idx
        ON account_security_notifications(status, next_attempt_at, created_at)
        WHERE status IN ('pending', 'sending');
    `);
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${SCHEMA_LOCK})`).catch(() => undefined);
    client.release();
  }
}

export function buildNewDeviceNotificationMessage(row, appUrl) {
  const displayName = safeText(row.display_name, 100) || 'there';
  const browser = browserLabel(row.user_agent);
  const device = deviceLabel(row.user_agent);
  const occurredAt = new Date(row.session_created_at || Date.now());
  const timestamp = Number.isNaN(occurredAt.getTime())
    ? 'Recently'
    : new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC'
    }).format(occurredAt);
  const securityUrl = `${String(appUrl || '').replace(/\/$/, '')}/settings/security`;
  const subject = 'New sign-in to your Ops Solutions account';
  const text = [
    `Hi ${displayName},`,
    'We noticed a sign-in from a device or browser that has not been seen on your account before.',
    `Browser: ${browser}`,
    `Device: ${device}`,
    `Time: ${timestamp} UTC`,
    'If this was you, no action is needed. If not, review your active sessions and reset your password immediately.',
    `Review account security: ${securityUrl}`
  ].join('\n\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f4f7f6;font-family:Arial,sans-serif;color:#17332f"><div style="max-width:620px;margin:0 auto;padding:32px 16px"><div style="background:#fff;border:1px solid #dce8e5;border-radius:18px;padding:28px"><div style="font-size:12px;letter-spacing:.12em;color:#52746e;font-weight:700">OPS SOLUTIONS SECURITY</div><h1 style="font-size:25px;margin:12px 0 10px">New sign-in detected</h1><p style="line-height:1.6;color:#355d56">Hi ${escapeHtml(displayName)}, we noticed a sign-in from a device or browser that has not been seen on your account before.</p><div style="background:#f2f8f6;border-left:4px solid #087f68;border-radius:12px;padding:16px;margin:20px 0"><p style="margin:0 0 8px"><strong>Browser:</strong> ${escapeHtml(browser)}</p><p style="margin:0 0 8px"><strong>Device:</strong> ${escapeHtml(device)}</p><p style="margin:0"><strong>Time:</strong> ${escapeHtml(timestamp)} UTC</p></div><p style="line-height:1.6;color:#355d56">If this was you, no action is needed. If not, review your sessions and reset your password immediately.</p><a href="${escapeHtml(securityUrl)}" style="display:inline-block;margin-top:8px;background:#087f68;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px">Review account security</a></div></div></body></html>`;
  return { subject, text, html, browser, device, timestamp };
}

async function discoverCandidates(postgres, lookbackMinutes) {
  const result = await postgres.query(`
    INSERT INTO account_security_notifications(user_id, session_token_hash, notification_type)
    SELECT s.user_id, s.token_hash, 'new_device_login'
    FROM user_sessions s
    JOIN app_users u ON u.id = s.user_id AND u.status = 'active'
    WHERE s.created_at >= NOW() - ($1::int * INTERVAL '1 minute')
      AND EXISTS (
        SELECT 1 FROM user_sessions any_prior
        WHERE any_prior.user_id = s.user_id
          AND any_prior.created_at < s.created_at
      )
      AND NOT EXISTS (
        SELECT 1 FROM user_sessions familiar
        WHERE familiar.user_id = s.user_id
          AND familiar.created_at < s.created_at
          AND familiar.user_agent IS NOT DISTINCT FROM s.user_agent
          AND familiar.ip_hash IS NOT DISTINCT FROM s.ip_hash
      )
    ON CONFLICT (user_id, session_token_hash, notification_type) DO NOTHING
    RETURNING id
  `, [lookbackMinutes]);
  return result.rowCount;
}

async function claimNotification(postgres) {
  const client = await postgres.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      SELECT n.id, n.user_id, n.session_token_hash, n.attempt_count,
             u.email, u.display_name, s.user_agent, s.created_at AS session_created_at
      FROM account_security_notifications n
      JOIN app_users u ON u.id = n.user_id AND u.status = 'active'
      JOIN user_sessions s ON s.token_hash = n.session_token_hash AND s.user_id = n.user_id
      WHERE n.status IN ('pending', 'sending')
        AND n.next_attempt_at <= NOW()
        AND n.attempt_count < $1
      ORDER BY n.next_attempt_at, n.created_at
      LIMIT 1
      FOR UPDATE OF n SKIP LOCKED
    `, [MAX_ATTEMPTS]);
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const row = result.rows[0];
    await client.query(`
      UPDATE account_security_notifications
      SET status = 'sending', attempt_count = attempt_count + 1, updated_at = NOW()
      WHERE id = $1
    `, [row.id]);
    await client.query('COMMIT');
    return { ...row, attempt_count: Number(row.attempt_count) + 1 };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function markDelivered(postgres, row, result) {
  await postgres.query(`
    UPDATE account_security_notifications
    SET status = 'delivered', provider_message_id = $2, last_error = NULL,
        delivered_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND user_id = $3
  `, [row.id, result.providerMessageId, row.user_id]);
  await postgres.query(`
    INSERT INTO account_security_events(user_id, action, metadata)
    VALUES ($1, 'login.new_device_notified', $2::jsonb)
  `, [row.user_id, JSON.stringify({ notificationId: row.id })]);
}

async function markFailed(postgres, row, error, configured) {
  const retryable = configured && error.retryable !== false && row.attempt_count < MAX_ATTEMPTS;
  const nextAttempt = retryable ? new Date(Date.now() + retryDelayMs(row.attempt_count)) : new Date();
  await postgres.query(`
    UPDATE account_security_notifications
    SET status = $2, next_attempt_at = $3, last_error = $4, updated_at = NOW()
    WHERE id = $1 AND user_id = $5
  `, [
    row.id,
    retryable ? 'pending' : 'failed',
    nextAttempt,
    safeText(error.message || 'Security notification delivery failed.', 1000),
    row.user_id
  ]);
}

export async function processNewDeviceNotifications(postgres, {
  env = process.env,
  fetchImpl = fetch,
  appUrl = env.APP_URL || 'http://localhost:3210',
  lookbackMinutes = DEFAULT_LOOKBACK_MINUTES,
  maxNotifications = 10
} = {}) {
  await ensureNewDeviceNotificationSchema(postgres);
  const boundedLookback = Math.min(24 * 60, Math.max(5, Number(lookbackMinutes) || DEFAULT_LOOKBACK_MINUTES));
  const config = getEmailDeliveryConfiguration(env);
  const discovered = await discoverCandidates(postgres, boundedLookback);
  let delivered = 0;
  let failed = 0;
  for (let index = 0; index < Math.max(1, Number(maxNotifications) || 1); index += 1) {
    const row = await claimNotification(postgres);
    if (!row) break;
    try {
      const message = buildNewDeviceNotificationMessage(row, appUrl);
      const result = await sendEmail(config, {
        ...message,
        recipients: [row.email],
        attachment: null,
        idempotencyKey: `new-device-${String(row.id).replaceAll('-', '')}`
      }, fetchImpl);
      await markDelivered(postgres, row, result);
      delivered += 1;
    } catch (error) {
      await markFailed(postgres, row, error, config.configured);
      failed += 1;
    }
  }
  return { discovered, delivered, failed, provider: config.provider, configured: config.configured };
}

export function startNewDeviceNotificationLoop(postgres, options = {}) {
  let stopped = false;
  let timer = null;
  const intervalMs = Math.max(30_000, Number(options.intervalMs || process.env.NEW_DEVICE_NOTIFICATION_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS));
  async function tick() {
    if (stopped) return;
    try {
      await processNewDeviceNotifications(postgres, options);
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        event: 'new_device_notification_loop_failed',
        message: safeText(error.message, 1000)
      }));
    } finally {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  }
  timer = setTimeout(tick, 10_000);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
