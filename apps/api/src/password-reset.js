import { hashValue, randomToken } from './crypto.js';
import { hashPassword, normalizeEmail, validatePassword } from './customer-auth.js';
import { getEmailDeliveryConfiguration, sendEmail } from './email-delivery.js';

const RESET_TTL_MINUTES = 30;
const REQUEST_LIMIT = 5;
const REQUEST_WINDOW_SECONDS = 60 * 60;
const GENERIC_RESPONSE = Object.freeze({
  status: 'accepted',
  message: 'If an active account exists for this email, password reset instructions will be sent.'
});

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safeAppUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['https:', 'http:'].includes(url.protocol) ? url.origin : '';
  } catch {
    return '';
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export async function ensurePasswordResetSchema(postgres) {
  await postgres.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      requested_ip_hash CHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS password_reset_tokens_user_expiry_idx
      ON password_reset_tokens(user_id, expires_at DESC);
    CREATE INDEX IF NOT EXISTS password_reset_tokens_active_expiry_idx
      ON password_reset_tokens(expires_at)
      WHERE used_at IS NULL;
  `);
}

export function buildPasswordResetMessage({ displayName, resetUrl, expiresInMinutes = RESET_TTL_MINUTES }) {
  const name = String(displayName || 'there').trim().slice(0, 100);
  const safeUrl = String(resetUrl);
  const subject = 'Reset your Ops Intelligence password';
  const text = [
    `Hi ${name},`,
    'A password reset was requested for your Ops Intelligence account.',
    `Reset your password: ${safeUrl}`,
    `This link expires in ${expiresInMinutes} minutes and can only be used once.`,
    'If you did not request this, you can ignore this email.'
  ].join('\n\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f4f7f6;font-family:Arial,sans-serif;color:#17332f"><div style="max-width:620px;margin:0 auto;padding:32px 16px"><div style="background:#fff;border:1px solid #dce8e5;border-radius:18px;padding:30px"><div style="font-size:12px;letter-spacing:.12em;color:#52746e;font-weight:700">OPS INTELLIGENCE</div><h1 style="font-size:25px;margin:14px 0 10px">Reset your password</h1><p style="line-height:1.6;color:#52746e">Hi ${escapeHtml(name)}, a password reset was requested for your account.</p><a href="${escapeHtml(safeUrl)}" style="display:inline-block;background:#087f68;color:#fff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:10px;margin:12px 0 18px">Reset password</a><p style="font-size:13px;line-height:1.6;color:#52746e">This link expires in ${Number(expiresInMinutes)} minutes and can only be used once. If you did not request this, ignore this email.</p></div></div></body></html>`;
  return { subject, text, html };
}

async function enforceRateLimit(redis, email, request) {
  const ip = String(request.ip || 'unknown');
  const bucket = Math.floor(Date.now() / (REQUEST_WINDOW_SECONDS * 1000));
  const key = `ops:password-reset:${hashValue(`${email}|${ip}|${bucket}`)}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, REQUEST_WINDOW_SECONDS);
  return count <= REQUEST_LIMIT;
}

export function registerPasswordResetRoutes(app, {
  postgres,
  redis,
  withTransaction,
  writeAudit,
  appUrl,
  env = process.env,
  send = sendEmail
}) {
  app.post('/api/v1/auth/password-reset/request', async (request) => {
    const email = normalizeEmail(request.body?.email);
    if (!validEmail(email)) return GENERIC_RESPONSE;
    const allowed = await enforceRateLimit(redis, email, request);
    if (!allowed) return GENERIC_RESPONSE;

    const result = await postgres.query(
      `SELECT id, email, display_name
       FROM app_users
       WHERE email = $1 AND status = 'active'
       LIMIT 1`,
      [email]
    );
    const user = result.rows[0];
    if (!user) return GENERIC_RESPONSE;

    const baseUrl = safeAppUrl(appUrl);
    const delivery = getEmailDeliveryConfiguration(env);
    if (!baseUrl || !delivery.configured) {
      app.log.warn({ event: 'password_reset_delivery_unavailable', provider: delivery.provider }, 'Password reset email delivery is not configured');
      return GENERIC_RESPONSE;
    }

    const token = randomToken(48);
    const tokenHash = hashValue(token);
    const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE password_reset_tokens
         SET used_at = NOW()
         WHERE user_id = $1 AND used_at IS NULL`,
        [user.id]
      );
      await client.query(
        `INSERT INTO password_reset_tokens(user_id, token_hash, expires_at, requested_ip_hash)
         VALUES ($1, $2, NOW() + ($3::int * INTERVAL '1 minute'), $4)`,
        [user.id, tokenHash, RESET_TTL_MINUTES, request.ip ? hashValue(request.ip) : null]
      );
    });

    try {
      const message = buildPasswordResetMessage({ displayName: user.display_name, resetUrl });
      await send(delivery, {
        recipients: [user.email],
        ...message,
        idempotencyKey: `password-reset-${tokenHash.slice(0, 32)}`
      });
      await writeAudit(request, {
        actorUserId: user.id,
        action: 'auth.password_reset_requested',
        targetType: 'user',
        targetId: user.id,
        metadata: { provider: delivery.provider }
      });
    } catch (error) {
      await postgres.query(
        'UPDATE password_reset_tokens SET used_at = NOW() WHERE token_hash = $1',
        [tokenHash]
      );
      app.log.error({ event: 'password_reset_delivery_failed', category: error.category || 'delivery_failed' }, 'Password reset email delivery failed');
    }
    return GENERIC_RESPONSE;
  });

  app.post('/api/v1/auth/password-reset/confirm', async (request, reply) => {
    const token = String(request.body?.token ?? '').trim();
    const password = String(request.body?.password ?? '');
    if (token.length < 32 || !validatePassword(password)) {
      return reply.code(400).send({
        error: 'invalid_password_reset',
        message: 'Enter a valid reset link and a password of at least 10 characters.'
      });
    }

    const passwordHash = await hashPassword(password);
    const reset = await withTransaction(async (client) => {
      const tokenResult = await client.query(
        `SELECT id, user_id
         FROM password_reset_tokens
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
         LIMIT 1
         FOR UPDATE`,
        [hashValue(token)]
      );
      const row = tokenResult.rows[0];
      if (!row) return null;
      const userResult = await client.query(
        `UPDATE app_users
         SET password_hash = $2, updated_at = NOW()
         WHERE id = $1 AND status = 'active'
         RETURNING id`,
        [row.user_id, passwordHash]
      );
      if (userResult.rowCount === 0) return null;
      await client.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [row.user_id]);
      await client.query('DELETE FROM user_sessions WHERE user_id = $1', [row.user_id]);
      return row;
    });

    if (!reset) {
      return reply.code(410).send({
        error: 'password_reset_unavailable',
        message: 'This password reset link is invalid, expired, or already used.'
      });
    }
    await writeAudit(request, {
      actorUserId: reset.user_id,
      action: 'auth.password_reset_completed',
      targetType: 'user',
      targetId: reset.user_id
    });
    return { status: 'reset', message: 'Your password has been updated. Sign in again on all devices.' };
  });
}
