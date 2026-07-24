import { hashValue } from './crypto.js';

const SESSION_KEY_PATTERN = /^[0-9a-f]{64}$/i;
const EVENT_LIMIT = 30;

function sessionTokenFromRequest(request) {
  const value = request.headers['x-session-token'];
  return typeof value === 'string' ? value.trim() : '';
}

function sessionKeyExpression(alias = 's') {
  return `encode(digest(${alias}.token_hash || ':' || ${alias}.user_id::text, 'sha256'), 'hex')`;
}

function clientLabel(userAgent) {
  const value = String(userAgent ?? '').trim();
  if (!value) return 'Unknown browser';
  if (/iphone|ipad/i.test(value)) return 'Safari on iOS';
  if (/android/i.test(value)) return /chrome/i.test(value) ? 'Chrome on Android' : 'Android browser';
  if (/edg\//i.test(value)) return 'Microsoft Edge';
  if (/firefox\//i.test(value)) return 'Mozilla Firefox';
  if (/chrome\//i.test(value)) return 'Google Chrome';
  if (/safari\//i.test(value)) return 'Apple Safari';
  return 'Web browser';
}

export function serializeSession(row) {
  return {
    id: row.session_key,
    current: Boolean(row.current_session),
    client: clientLabel(row.user_agent),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at
  };
}

export async function ensureAccountSecuritySchema(postgres) {
  await postgres.query(`
    CREATE TABLE IF NOT EXISTS account_security_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      ip_hash CHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (action IN (
        'session.revoked',
        'sessions.revoked_others',
        'password.reset_completed',
        'password.reset_requested',
        'password.reset_delivery_failed'
      ))
    );
    CREATE INDEX IF NOT EXISTS account_security_events_user_created_idx
      ON account_security_events(user_id, created_at DESC);
  `);
}

async function writeSecurityEvent(postgres, request, userId, action, metadata = {}) {
  await postgres.query(
    `INSERT INTO account_security_events(user_id, action, metadata, ip_hash)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [userId, action, JSON.stringify(metadata), request.ip ? hashValue(request.ip) : null]
  );
}

export function registerAccountSecurityRoutes(app, { postgres }) {
  const schemaReady = ensureAccountSecuritySchema(postgres);

  async function requireAccountSession(request, reply) {
    await schemaReady;
    const token = sessionTokenFromRequest(request);
    if (!token) {
      return reply.code(401).send({ error: 'customer_session_required', message: 'Sign in to continue.' });
    }
    const tokenHash = hashValue(token);
    const result = await postgres.query(
      `SELECT s.token_hash, s.user_id, u.email, u.display_name
       FROM user_sessions s
       JOIN app_users u ON u.id = s.user_id
       WHERE s.token_hash = $1
         AND s.expires_at > NOW()
         AND u.status = 'active'
       LIMIT 1`,
      [tokenHash]
    );
    if (result.rowCount === 0) {
      return reply.code(401).send({ error: 'customer_session_required', message: 'Sign in to continue.' });
    }
    request.accountSecurity = { ...result.rows[0], tokenHash };
  }

  app.get('/api/v1/customer/security', { preHandler: requireAccountSession }, async (request) => {
    const { user_id: userId, tokenHash } = request.accountSecurity;
    const [sessionsResult, eventsResult] = await Promise.all([
      postgres.query(
        `SELECT ${sessionKeyExpression('s')} AS session_key,
                (s.token_hash = $2) AS current_session,
                s.user_agent, s.created_at, s.last_seen_at, s.expires_at
         FROM user_sessions s
         WHERE s.user_id = $1 AND s.expires_at > NOW()
         ORDER BY current_session DESC, s.last_seen_at DESC, s.created_at DESC
         LIMIT 50`,
        [userId, tokenHash]
      ),
      postgres.query(
        `SELECT id, action, metadata, created_at
         FROM account_security_events
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, EVENT_LIMIT]
      )
    ]);
    return {
      sessions: sessionsResult.rows.map(serializeSession),
      events: eventsResult.rows.map((row) => ({
        id: row.id,
        action: row.action,
        metadata: row.metadata ?? {},
        createdAt: row.created_at
      }))
    };
  });

  app.delete('/api/v1/customer/security/sessions/:sessionId', { preHandler: requireAccountSession }, async (request, reply) => {
    const sessionId = String(request.params.sessionId ?? '').trim();
    if (!SESSION_KEY_PATTERN.test(sessionId)) {
      return reply.code(400).send({ error: 'invalid_session_id', message: 'Session ID is invalid.' });
    }
    const { user_id: userId, tokenHash } = request.accountSecurity;
    const result = await postgres.query(
      `DELETE FROM user_sessions s
       WHERE s.user_id = $1
         AND ${sessionKeyExpression('s')} = $2
         AND s.token_hash <> $3
       RETURNING s.created_at, s.last_seen_at`,
      [userId, sessionId, tokenHash]
    );
    if (result.rowCount === 0) {
      return reply.code(404).send({
        error: 'session_not_found',
        message: 'The session was not found or is the session currently in use.'
      });
    }
    await writeSecurityEvent(postgres, request, userId, 'session.revoked', {
      sessionId,
      lastSeenAt: result.rows[0].last_seen_at
    });
    return reply.code(204).send();
  });

  app.delete('/api/v1/customer/security/sessions', { preHandler: requireAccountSession }, async (request) => {
    const { user_id: userId, tokenHash } = request.accountSecurity;
    const result = await postgres.query(
      `DELETE FROM user_sessions
       WHERE user_id = $1 AND token_hash <> $2
       RETURNING token_hash`,
      [userId, tokenHash]
    );
    await writeSecurityEvent(postgres, request, userId, 'sessions.revoked_others', {
      revokedCount: result.rowCount
    });
    return { revokedCount: result.rowCount };
  });

  return { requireAccountSession };
}
