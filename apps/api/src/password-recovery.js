import { hashValue, randomToken } from './crypto.js';
import { getEmailDeliveryConfiguration, sendEmail } from './email-delivery.js';
import { hashPassword, normalizeEmail, validatePassword } from './customer-auth.js';

const TOKEN_TTL_MINUTES = 30;
const REQUEST_LIMIT_PER_EMAIL = 3;
const REQUEST_LIMIT_PER_IP = 10;
const RESET_LIMIT_PER_IP = 20;
const RATE_WINDOW_MINUTES = 60;
const RESET_WINDOW_MINUTES = 15;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_hash CHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    requested_ip_hash CHAR(64),
    requested_user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS password_reset_rate_events (
    id BIGSERIAL PRIMARY KEY,
    rate_key CHAR(64) NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('request','consume')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS password_reset_tokens_user_created_idx
    ON password_reset_tokens(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry_idx
    ON password_reset_tokens(expires_at) WHERE consumed_at IS NULL;
  CREATE INDEX IF NOT EXISTS password_reset_rate_events_key_created_idx
    ON password_reset_rate_events(rate_key, action, created_at DESC);
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

function requestIp(request) {
  return safeText(request.ip || request.headers['x-forwarded-for'] || 'unknown', 200);
}

async function enforceDatabaseRateLimit(postgres, rateKey, action, limit, windowMinutes) {
  const result = await postgres.query(
    `WITH recent AS (
       SELECT COUNT(*)::int AS count
       FROM password_reset_rate_events
       WHERE rate_key = $1 AND action = $2
         AND created_at > NOW() - ($4::int * INTERVAL '1 minute')
     ), inserted AS (
       INSERT INTO password_reset_rate_events(rate_key, action)
       SELECT $1, $2 FROM recent WHERE count < $3
       RETURNING id
     )
     SELECT recent.count, EXISTS(SELECT 1 FROM inserted) AS accepted FROM recent`,
    [rateKey, action, limit, windowMinutes]
  );
  if (!result.rows[0]?.accepted) {
    const error = new Error('Too many requests. Try again later.');
    error.statusCode = 429;
    error.category = 'RATE_LIMITED';
    throw error;
  }
  if (Math.random() < 0.02) {
    await postgres.query("DELETE FROM password_reset_rate_events WHERE created_at < NOW() - INTERVAL '2 days'");
  }
}

export async function ensurePasswordRecoverySchema(postgres) {
  await postgres.query(SCHEMA_SQL);
}

export function buildPasswordResetMessage({ displayName, resetUrl }) {
  const name = safeText(displayName, 100) || 'there';
  const url = safeText(resetUrl, 2000);
  return {
    subject: 'Reset your Ops Solutions password',
    text: [
      `Hi ${name},`,
      'A password reset was requested for your Ops Solutions account.',
      `Reset your password: ${url}`,
      `This link expires in ${TOKEN_TTL_MINUTES} minutes and can only be used once.`,
      'If you did not request this, you can safely ignore this email.'
    ].join('\n\n'),
    html: `<!doctype html><html><body style="margin:0;background:#f4f7f6;font-family:Arial,sans-serif;color:#17332f"><div style="max-width:620px;margin:0 auto;padding:32px 16px"><div style="background:#fff;border:1px solid #dce8e5;border-radius:18px;padding:28px"><div style="font-size:12px;letter-spacing:.12em;color:#52746e;font-weight:700">OPS SOLUTIONS</div><h1 style="font-size:25px;margin:12px 0">Reset your password</h1><p>Hi ${escapeHtml(name)},</p><p style="color:#52746e;line-height:1.6">A password reset was requested for your account. This secure link expires in ${TOKEN_TTL_MINUTES} minutes and can only be used once.</p><a href="${escapeHtml(url)}" style="display:inline-block;margin:16px 0;padding:12px 18px;border-radius:10px;background:#087f68;color:#fff;text-decoration:none;font-weight:700">Reset password</a><p style="font-size:13px;color:#6d8581;line-height:1.5">If you did not request this, no action is needed. Existing sessions remain active unless the password is changed.</p></div></div></body></html>`
  };
}

export function registerPasswordRecoveryRoutes(app, {
  postgres,
  withTransaction,
  appUrl = process.env.APP_URL || 'http://localhost:3210',
  emailConfig = getEmailDeliveryConfiguration(),
  sendEmailImpl = sendEmail
}) {
  const schemaReady = ensurePasswordRecoverySchema(postgres);

  app.post('/api/v1/auth/password/forgot', async (request, reply) => {
    await schemaReady;
    const email = normalizeEmail(request.body?.email);
    const ipHash = hashValue(requestIp(request));
    const generic = {
      accepted: true,
      message: 'If an active account exists for that email, a password reset link will be sent.'
    };

    await Promise.all([
      enforceDatabaseRateLimit(postgres, hashValue(`email:${email || 'invalid'}`), 'request', REQUEST_LIMIT_PER_EMAIL, RATE_WINDOW_MINUTES),
      enforceDatabaseRateLimit(postgres, hashValue(`ip:${ipHash}`), 'request', REQUEST_LIMIT_PER_IP, RATE_WINDOW_MINUTES)
    ]);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply.code(202).send(generic);
    const userResult = await postgres.query(
      `SELECT id, email, display_name FROM app_users WHERE email = $1 AND status = 'active' LIMIT 1`,
      [email]
    );
    const user = userResult.rows[0];
    if (!user || !emailConfig.configured) {
      if (user && !emailConfig.configured) request.log.warn({ missing: emailConfig.missing }, 'Password reset email provider is not configured');
      return reply.code(202).send(generic);
    }

    const token = randomToken(48);
    const tokenHash = hashValue(token);
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE password_reset_tokens SET consumed_at = NOW() WHERE user_id = $1 AND consumed_at IS NULL`,
        [user.id]
      );
      await client.query(
        `INSERT INTO password_reset_tokens(token_hash, user_id, expires_at, requested_ip_hash, requested_user_agent)
         VALUES ($1, $2, NOW() + ($3::int * INTERVAL '1 minute'), $4, $5)`,
        [tokenHash, user.id, TOKEN_TTL_MINUTES, ipHash, safeText(request.headers['user-agent'], 500) || null]
      );
    });

    const resetUrl = `${String(appUrl).replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
    try {
      await sendEmailImpl(emailConfig, {
        recipients: [user.email],
        ...buildPasswordResetMessage({ displayName: user.display_name, resetUrl }),
        idempotencyKey: `password-reset-${tokenHash.slice(0, 32)}`
      });
    } catch (error) {
      await postgres.query('UPDATE password_reset_tokens SET consumed_at = NOW() WHERE token_hash = $1', [tokenHash]);
      request.log.error({ category: error.category, retryable: error.retryable }, 'Password reset delivery failed');
    }
    return reply.code(202).send(generic);
  });

  app.post('/api/v1/auth/password/reset', async (request, reply) => {
    await schemaReady;
    const token = safeText(request.body?.token, 500);
    const password = String(request.body?.password ?? '');
    const ipHash = hashValue(requestIp(request));
    await enforceDatabaseRateLimit(postgres, hashValue(`consume:${ipHash}`), 'consume', RESET_LIMIT_PER_IP, RESET_WINDOW_MINUTES);

    if (!token || !validatePassword(password)) {
      return reply.code(400).send({
        error: 'invalid_password_reset',
        message: 'Enter a valid reset token and a password between 10 and 200 characters.'
      });
    }

    const passwordHash = await hashPassword(password);
    const result = await withTransaction(async (client) => {
      const tokenResult = await client.query(
        `UPDATE password_reset_tokens SET consumed_at = NOW()
         WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > NOW()
         RETURNING user_id`,
        [hashValue(token)]
      );
      if (tokenResult.rowCount === 0) return null;
      const userId = tokenResult.rows[0].user_id;
      await client.query('UPDATE app_users SET password_hash = $2, updated_at = NOW() WHERE id = $1', [userId, passwordHash]);
      const revoked = await client.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
      await client.query('UPDATE password_reset_tokens SET consumed_at = NOW() WHERE user_id = $1 AND consumed_at IS NULL', [userId]);
      await client.query(
        `INSERT INTO audit_events(actor_user_id, action, target_type, target_id, metadata, ip_hash)
         VALUES ($1, 'account.password_reset', 'user', $1::text, $2::jsonb, $3)`,
        [userId, JSON.stringify({ revokedSessions: revoked.rowCount }), ipHash]
      );
      return { revokedSessions: revoked.rowCount };
    });

    if (!result) {
      return reply.code(410).send({
        error: 'password_reset_unavailable',
        message: 'This password reset link is invalid, expired, or has already been used.'
      });
    }
    return {
      reset: true,
      sessionsRevoked: result.revokedSessions,
      message: 'Your password has been changed. Sign in again on every device.'
    };
  });
}
