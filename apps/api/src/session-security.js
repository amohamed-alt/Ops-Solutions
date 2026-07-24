const DEFAULT_MAX_ACTIVE_SESSIONS = 10;
const DEFAULT_STALE_DAYS = 45;
const DEFAULT_BATCH_LIMIT = 500;

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeUserId(value) {
  const id = String(value ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    const error = new Error('A valid user UUID is required.');
    error.statusCode = 400;
    throw error;
  }
  return id;
}

export function normalizeSessionSecurityOptions(input = {}) {
  return {
    maxActiveSessions: boundedInteger(input.maxActiveSessions, DEFAULT_MAX_ACTIVE_SESSIONS, 1, 100),
    staleDays: boundedInteger(input.staleDays, DEFAULT_STALE_DAYS, 1, 365),
    limit: boundedInteger(input.limit, 100, 1, DEFAULT_BATCH_LIMIT),
    dryRun: Boolean(input.dryRun)
  };
}

export async function inspectSessionSecurity(postgres, input = {}) {
  const options = normalizeSessionSecurityOptions(input);
  const [summaryResult, riskyUsersResult, staleSessionsResult] = await Promise.all([
    postgres.query(`
      SELECT
        COUNT(*)::int AS total_sessions,
        COUNT(*) FILTER (WHERE expires_at > NOW())::int AS active_sessions,
        COUNT(*) FILTER (WHERE expires_at <= NOW())::int AS expired_sessions,
        COUNT(*) FILTER (
          WHERE expires_at > NOW()
            AND COALESCE(last_seen_at, created_at) < NOW() - ($1::int * INTERVAL '1 day')
        )::int AS stale_sessions,
        COUNT(DISTINCT user_id) FILTER (WHERE expires_at > NOW())::int AS users_with_active_sessions
      FROM user_sessions
    `, [options.staleDays]),
    postgres.query(`
      SELECT u.id AS user_id, u.email, u.display_name,
             COUNT(*)::int AS active_session_count,
             MIN(s.created_at) AS oldest_active_session,
             MAX(s.last_seen_at) AS newest_activity
      FROM user_sessions s
      JOIN app_users u ON u.id = s.user_id
      WHERE s.expires_at > NOW() AND u.status = 'active'
      GROUP BY u.id, u.email, u.display_name
      HAVING COUNT(*) > $1
      ORDER BY COUNT(*) DESC, u.email
      LIMIT $2
    `, [options.maxActiveSessions, options.limit]),
    postgres.query(`
      SELECT s.user_id, u.email, COUNT(*)::int AS stale_session_count,
             MIN(COALESCE(s.last_seen_at, s.created_at)) AS oldest_last_seen,
             MAX(s.expires_at) AS latest_expiry
      FROM user_sessions s
      JOIN app_users u ON u.id = s.user_id
      WHERE s.expires_at > NOW()
        AND COALESCE(s.last_seen_at, s.created_at) < NOW() - ($1::int * INTERVAL '1 day')
      GROUP BY s.user_id, u.email
      ORDER BY COUNT(*) DESC, u.email
      LIMIT $2
    `, [options.staleDays, options.limit])
  ]);

  return {
    generatedAt: new Date().toISOString(),
    policy: {
      maxActiveSessions: options.maxActiveSessions,
      staleDays: options.staleDays
    },
    summary: summaryResult.rows[0] ?? {},
    riskyUsers: riskyUsersResult.rows,
    staleUsers: staleSessionsResult.rows
  };
}

export async function pruneExpiredSessions(postgres, { dryRun = true } = {}) {
  if (dryRun) {
    const result = await postgres.query('SELECT COUNT(*)::int AS count FROM user_sessions WHERE expires_at <= NOW()');
    return { dryRun: true, deleted: 0, candidates: Number(result.rows[0]?.count ?? 0) };
  }
  const result = await postgres.query('DELETE FROM user_sessions WHERE expires_at <= NOW() RETURNING token_hash');
  return { dryRun: false, deleted: result.rowCount, candidates: result.rowCount };
}

export async function revokeUserSessions(postgres, userId, { keepTokenHash = null, dryRun = true } = {}) {
  const id = normalizeUserId(userId);
  const values = [id];
  let keepClause = '';
  if (keepTokenHash) {
    values.push(String(keepTokenHash));
    keepClause = 'AND token_hash <> $2';
  }
  if (dryRun) {
    const result = await postgres.query(
      `SELECT COUNT(*)::int AS count FROM user_sessions WHERE user_id = $1 ${keepClause}`,
      values
    );
    return { dryRun: true, revoked: 0, candidates: Number(result.rows[0]?.count ?? 0) };
  }
  const result = await postgres.query(
    `DELETE FROM user_sessions WHERE user_id = $1 ${keepClause} RETURNING token_hash`,
    values
  );
  return { dryRun: false, revoked: result.rowCount, candidates: result.rowCount };
}

export async function enforceSessionCap(postgres, userId, maxActiveSessions, { dryRun = true } = {}) {
  const id = normalizeUserId(userId);
  const cap = boundedInteger(maxActiveSessions, DEFAULT_MAX_ACTIVE_SESSIONS, 1, 100);
  const result = await postgres.query(`
    SELECT token_hash
    FROM user_sessions
    WHERE user_id = $1 AND expires_at > NOW()
    ORDER BY last_seen_at DESC, created_at DESC, token_hash DESC
    OFFSET $2
  `, [id, cap]);
  if (dryRun || result.rowCount === 0) {
    return { dryRun: Boolean(dryRun), revoked: 0, candidates: result.rowCount, cap };
  }
  const hashes = result.rows.map((row) => row.token_hash);
  const deleted = await postgres.query(
    'DELETE FROM user_sessions WHERE user_id = $1 AND token_hash = ANY($2::char(64)[]) RETURNING token_hash',
    [id, hashes]
  );
  return { dryRun: false, revoked: deleted.rowCount, candidates: result.rowCount, cap };
}

export async function enforceAllSessionCaps(postgres, input = {}) {
  const options = normalizeSessionSecurityOptions(input);
  if (options.dryRun) {
    const result = await postgres.query(`
      WITH ranked AS (
        SELECT user_id,
               ROW_NUMBER() OVER (
                 PARTITION BY user_id
                 ORDER BY last_seen_at DESC, created_at DESC, token_hash DESC
               ) AS session_rank
        FROM user_sessions
        WHERE expires_at > NOW()
      ), overflow AS (
        SELECT user_id
        FROM ranked
        WHERE session_rank > $1
      )
      SELECT COUNT(*)::int AS candidate_sessions,
             COUNT(DISTINCT user_id)::int AS affected_users
      FROM overflow
    `, [options.maxActiveSessions]);
    return {
      dryRun: true,
      cap: options.maxActiveSessions,
      candidateSessions: Number(result.rows[0]?.candidate_sessions ?? 0),
      affectedUsers: Number(result.rows[0]?.affected_users ?? 0),
      revoked: 0
    };
  }

  const result = await postgres.query(`
    WITH lock_acquired AS (
      SELECT pg_advisory_xact_lock(hashtextextended('ops-solutions:enforce-all-session-caps', 0))
    ), ranked AS (
      SELECT s.token_hash,
             s.user_id,
             ROW_NUMBER() OVER (
               PARTITION BY s.user_id
               ORDER BY s.last_seen_at DESC, s.created_at DESC, s.token_hash DESC
             ) AS session_rank
      FROM user_sessions s
      CROSS JOIN lock_acquired
      JOIN app_users u ON u.id = s.user_id
      WHERE s.expires_at > NOW() AND u.status = 'active'
    ), overflow AS (
      SELECT token_hash, user_id
      FROM ranked
      WHERE session_rank > $1
      ORDER BY user_id, session_rank DESC
      LIMIT $2
    ), deleted AS (
      DELETE FROM user_sessions s
      USING overflow o
      WHERE s.token_hash = o.token_hash AND s.user_id = o.user_id
      RETURNING s.user_id
    )
    SELECT COUNT(*)::int AS revoked,
           COUNT(DISTINCT user_id)::int AS affected_users
    FROM deleted
  `, [options.maxActiveSessions, options.limit]);

  return {
    dryRun: false,
    cap: options.maxActiveSessions,
    batchLimit: options.limit,
    revoked: Number(result.rows[0]?.revoked ?? 0),
    affectedUsers: Number(result.rows[0]?.affected_users ?? 0)
  };
}
