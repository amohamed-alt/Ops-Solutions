const DEFAULT_MAX_ACTIVE_SESSIONS = 10;
const DEFAULT_STALE_DAYS = 45;

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function normalizeSessionSecurityOptions(input = {}) {
  return {
    maxActiveSessions: boundedInteger(input.maxActiveSessions, DEFAULT_MAX_ACTIVE_SESSIONS, 1, 100),
    staleDays: boundedInteger(input.staleDays, DEFAULT_STALE_DAYS, 1, 365),
    limit: boundedInteger(input.limit, 100, 1, 500),
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
        COUNT(*) FILTER (WHERE last_seen_at < NOW() - ($1::int * INTERVAL '1 day'))::int AS stale_sessions,
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
             MIN(s.last_seen_at) AS oldest_last_seen,
             MAX(s.expires_at) AS latest_expiry
      FROM user_sessions s
      JOIN app_users u ON u.id = s.user_id
      WHERE s.last_seen_at < NOW() - ($1::int * INTERVAL '1 day')
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
  const id = String(userId ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    const error = new Error('A valid user UUID is required.');
    error.statusCode = 400;
    throw error;
  }
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
  const id = String(userId ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('A valid user UUID is required.');
  const cap = boundedInteger(maxActiveSessions, DEFAULT_MAX_ACTIVE_SESSIONS, 1, 100);
  const result = await postgres.query(`
    SELECT token_hash
    FROM user_sessions
    WHERE user_id = $1 AND expires_at > NOW()
    ORDER BY last_seen_at DESC, created_at DESC
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
