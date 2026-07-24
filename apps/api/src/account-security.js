import { hashValue } from './crypto.js';

const SESSION_KEY_PATTERN = /^[0-9a-f]{64}$/i;
const EVENT_LIMIT = 30;
const DEFAULT_STALE_DAYS = 30;
const MIN_STALE_DAYS = 7;
const MAX_STALE_DAYS = 180;

function sessionTokenFromRequest(request) {
  const value = request.headers['x-session-token'];
  return typeof value === 'string' ? value.trim() : '';
}

function sessionKeyExpression(alias = 's') {
  return `encode(digest(${alias}.token_hash || ':' || ${alias}.user_id::text, 'sha256'), 'hex')`;
}

function deviceFingerprintExpression(alias = 's') {
  return `encode(digest(COALESCE(${alias}.user_agent, '') || ':' || COALESCE(${alias}.ip_hash, ''), 'sha256'), 'hex')`;
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

function ageInDays(value, now) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now.getTime() - timestamp) / 86_400_000));
}

export function classifySessionRisk(row, now = new Date()) {
  const dormantDays = ageInDays(row.last_seen_at ?? row.created_at, now);
  const ageDays = ageInDays(row.created_at, now);
  const familiarDevice = row.known_device !== false;
  const explicitlyTrusted = Boolean(row.explicitly_trusted);

  if (row.current_session && familiarDevice) {
    return {
      level: 'trusted',
      reason: explicitlyTrusted ? 'Current session on a trusted device' : 'Current session on a familiar device',
      dormantDays,
      familiarDevice,
      explicitlyTrusted
    };
  }
  if (!familiarDevice && ageDays <= 7) {
    return { level: 'review', reason: 'New device or browser', dormantDays, familiarDevice, explicitlyTrusted };
  }
  if (dormantDays >= 30) {
    return { level: 'high', reason: `Inactive for ${dormantDays} days`, dormantDays, familiarDevice, explicitlyTrusted };
  }
  if (dormantDays >= 14 || ageDays >= 90) {
    return {
      level: 'review',
      reason: dormantDays >= 14 ? `Inactive for ${dormantDays} days` : `Session is ${ageDays} days old`,
      dormantDays,
      familiarDevice,
      explicitlyTrusted
    };
  }
  return {
    level: 'normal',
    reason: familiarDevice ? 'Recently active' : 'Unrecognized device history',
    dormantDays,
    familiarDevice,
    explicitlyTrusted
  };
}

export function serializeSession(row, now = new Date()) {
  const risk = classifySessionRisk(row, now);
  return {
    id: row.session_key,
    current: Boolean(row.current_session),
    client: clientLabel(row.user_agent),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    familiarDevice: risk.familiarDevice,
    explicitlyTrusted: risk.explicitlyTrusted,
    risk
  };
}

export async function ensureAccountSecuritySchema(postgres) {
  await postgres.query(`
    BEGIN;
    SELECT pg_advisory_xact_lock(hashtextextended('ops-solutions:account-security-schema', 0));
    CREATE TABLE IF NOT EXISTS account_security_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      ip_hash CHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS account_trusted_devices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      fingerprint_hash CHAR(64) NOT NULL,
      label TEXT NOT NULL,
      trusted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, fingerprint_hash)
    );
    DO $$
    DECLARE
      current_definition TEXT;
    BEGIN
      SELECT pg_get_constraintdef(oid)
        INTO current_definition
      FROM pg_constraint
      WHERE conrelid = 'account_security_events'::regclass
        AND conname = 'account_security_events_action_check';

      IF current_definition IS NULL OR POSITION('device.trusted' IN current_definition) = 0 THEN
        ALTER TABLE account_security_events
          DROP CONSTRAINT IF EXISTS account_security_events_action_check;
        ALTER TABLE account_security_events
          ADD CONSTRAINT account_security_events_action_check CHECK (action IN (
            'session.revoked',
            'sessions.revoked_others',
            'sessions.revoked_stale',
            'device.trusted',
            'password.reset_completed',
            'password.reset_requested',
            'password.reset_delivery_failed'
          ));
      END IF;
    END
    $$;
    CREATE INDEX IF NOT EXISTS account_security_events_user_created_idx
      ON account_security_events(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS user_sessions_device_familiarity_idx
      ON user_sessions(user_id, user_agent, ip_hash, created_at DESC);
    CREATE INDEX IF NOT EXISTS account_trusted_devices_user_seen_idx
      ON account_trusted_devices(user_id, last_seen_at DESC);
    COMMIT;
  `);
}

async function writeSecurityEvent(postgres, request, userId, action, metadata = {}) {
  await postgres.query(
    `INSERT INTO account_security_events(user_id, action, metadata, ip_hash)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [userId, action, JSON.stringify(metadata), request.ip ? hashValue(request.ip) : null]
  );
}

function staleDaysFromRequest(request) {
  const parsed = Number.parseInt(String(request.query?.days ?? DEFAULT_STALE_DAYS), 10);
  if (!Number.isInteger(parsed) || parsed < MIN_STALE_DAYS || parsed > MAX_STALE_DAYS) return null;
  return parsed;
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
                s.user_agent, s.created_at, s.last_seen_at, s.expires_at,
                EXISTS (
                  SELECT 1
                  FROM account_trusted_devices trusted
                  WHERE trusted.user_id = s.user_id
                    AND trusted.fingerprint_hash = ${deviceFingerprintExpression('s')}
                ) AS explicitly_trusted,
                (
                  EXISTS (
                    SELECT 1
                    FROM account_trusted_devices trusted
                    WHERE trusted.user_id = s.user_id
                      AND trusted.fingerprint_hash = ${deviceFingerprintExpression('s')}
                  )
                  OR EXISTS (
                    SELECT 1
                    FROM user_sessions prior
                    WHERE prior.user_id = s.user_id
                      AND prior.token_hash <> s.token_hash
                      AND prior.created_at < s.created_at
                      AND prior.user_agent IS NOT DISTINCT FROM s.user_agent
                      AND prior.ip_hash IS NOT DISTINCT FROM s.ip_hash
                  )
                ) AS known_device
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
    const sessions = sessionsResult.rows.map((row) => serializeSession(row));
    return {
      sessions,
      summary: {
        active: sessions.length,
        needsReview: sessions.filter((session) => ['review', 'high'].includes(session.risk.level)).length,
        highRisk: sessions.filter((session) => session.risk.level === 'high').length,
        unfamiliarDevices: sessions.filter((session) => !session.familiarDevice).length,
        trustedDevices: sessions.filter((session) => session.explicitlyTrusted).length
      },
      events: eventsResult.rows.map((row) => ({
        id: row.id,
        action: row.action,
        metadata: row.metadata ?? {},
        createdAt: row.created_at
      }))
    };
  });

  app.post('/api/v1/customer/security/devices/trust-current', { preHandler: requireAccountSession }, async (request, reply) => {
    const { user_id: userId, tokenHash } = request.accountSecurity;
    const result = await postgres.query(
      `INSERT INTO account_trusted_devices(user_id, fingerprint_hash, label, trusted_at, last_seen_at)
       SELECT s.user_id,
              ${deviceFingerprintExpression('s')},
              LEFT(COALESCE(NULLIF(s.user_agent, ''), 'Unknown browser'), 180),
              NOW(),
              NOW()
       FROM user_sessions s
       WHERE s.user_id = $1
         AND s.token_hash = $2
         AND s.expires_at > NOW()
       ON CONFLICT (user_id, fingerprint_hash)
       DO UPDATE SET last_seen_at = NOW(), label = EXCLUDED.label
       RETURNING id, trusted_at`,
      [userId, tokenHash]
    );
    if (result.rowCount === 0) {
      return reply.code(404).send({ error: 'current_session_not_found', message: 'The current session is no longer active.' });
    }
    await writeSecurityEvent(postgres, request, userId, 'device.trusted', {
      trustedDeviceId: result.rows[0].id
    });
    return reply.code(201).send({ trusted: true, trustedAt: result.rows[0].trusted_at });
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

  app.delete('/api/v1/customer/security/sessions/stale', { preHandler: requireAccountSession }, async (request, reply) => {
    const staleDays = staleDaysFromRequest(request);
    if (staleDays === null) {
      return reply.code(400).send({
        error: 'invalid_stale_days',
        message: `Stale session age must be between ${MIN_STALE_DAYS} and ${MAX_STALE_DAYS} days.`
      });
    }
    const { user_id: userId, tokenHash } = request.accountSecurity;
    const result = await postgres.query(
      `DELETE FROM user_sessions
       WHERE user_id = $1
         AND token_hash <> $2
         AND COALESCE(last_seen_at, created_at) < NOW() - ($3::integer * INTERVAL '1 day')
       RETURNING created_at, last_seen_at`,
      [userId, tokenHash, staleDays]
    );
    await writeSecurityEvent(postgres, request, userId, 'sessions.revoked_stale', {
      revokedCount: result.rowCount,
      staleDays
    });
    return { revokedCount: result.rowCount, staleDays };
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
