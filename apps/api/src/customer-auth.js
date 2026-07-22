import { promisify } from 'node:util';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

import { hashValue, randomToken } from './crypto.js';

const scrypt = promisify(scryptCallback);
const SESSION_DAYS = 30;
const PASSWORD_KEY_LENGTH = 64;

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function normalizeDisplayName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 100);
}

export function slugifyWorkspace(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}

export function validatePassword(value) {
  const password = String(value ?? '');
  return password.length >= 10 && password.length <= 200;
}

export async function hashPassword(password) {
  if (!validatePassword(password)) throw new TypeError('Password must be between 10 and 200 characters.');
  const salt = randomBytes(16);
  const derived = await scrypt(String(password), salt, PASSWORD_KEY_LENGTH);
  return `scrypt-v1.${salt.toString('base64url')}.${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  try {
    const [version, saltValue, hashValue] = String(encoded ?? '').split('.');
    if (version !== 'scrypt-v1' || !saltValue || !hashValue) return false;
    const expected = Buffer.from(hashValue, 'base64url');
    const actual = Buffer.from(await scrypt(String(password), Buffer.from(saltValue, 'base64url'), expected.length));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function sanitizeReturnPath(value, fallback = '/onboarding') {
  const path = String(value ?? '').trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return fallback;
  return path.slice(0, 300);
}

export async function ensureCustomerAuthSchema(postgres) {
  await postgres.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS workspace_memberships (
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'owner',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, workspace_id)
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      token_hash CHAR(64) PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      user_agent TEXT,
      ip_hash CHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS workspace_memberships_workspace_idx
      ON workspace_memberships(workspace_id, role);
    CREATE INDEX IF NOT EXISTS user_sessions_user_expiry_idx
      ON user_sessions(user_id, expires_at DESC);
    CREATE INDEX IF NOT EXISTS user_sessions_expiry_idx
      ON user_sessions(expires_at);

    ALTER TABLE oauth_states
      ADD COLUMN IF NOT EXISTS redirect_path TEXT NOT NULL DEFAULT '/setup';
  `);
}

function publicContext(row, workspaces) {
  return {
    user: {
      id: row.user_id,
      email: row.email,
      displayName: row.display_name
    },
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      status: workspace.status,
      role: workspace.role,
      portalId: workspace.portal_id ? Number(workspace.portal_id) : null,
      hubspotStatus: workspace.hubspot_status ?? null,
      lastDiscoveredAt: workspace.last_discovered_at ?? null
    }))
  };
}

async function createSession(postgres, userId, request) {
  const token = randomToken(48);
  const userAgent = String(request.headers['user-agent'] ?? '').slice(0, 500) || null;
  const ipHash = request.ip ? hashValue(request.ip) : null;
  await postgres.query(
    `INSERT INTO user_sessions(token_hash, user_id, expires_at, user_agent, ip_hash)
     VALUES ($1, $2, NOW() + ($3::int * INTERVAL '1 day'), $4, $5)`,
    [hashValue(token), userId, SESSION_DAYS, userAgent, ipHash]
  );
  return token;
}

async function loadContext(postgres, token, { touch = true } = {}) {
  if (!token) return null;
  const result = await postgres.query(
    `SELECT s.token_hash, s.user_id, u.email, u.display_name, u.status
     FROM user_sessions s
     JOIN app_users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.status = 'active'
     LIMIT 1`,
    [hashValue(token)]
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  const workspaceResult = await postgres.query(
    `SELECT w.id, w.name, w.slug, w.status, m.role,
            c.portal_id, c.status AS hubspot_status, c.last_discovered_at
     FROM workspace_memberships m
     JOIN workspaces w ON w.id = m.workspace_id
     LEFT JOIN hubspot_connections c ON c.workspace_id = w.id
     WHERE m.user_id = $1
     ORDER BY m.created_at, w.name`,
    [row.user_id]
  );
  if (touch) {
    await postgres.query('UPDATE user_sessions SET last_seen_at = NOW() WHERE token_hash = $1', [row.token_hash]);
  }
  return { ...publicContext(row, workspaceResult.rows), tokenHash: row.token_hash };
}

function sessionTokenFromRequest(request) {
  const value = request.headers['x-session-token'];
  return typeof value === 'string' ? value.trim() : '';
}

export function registerCustomerAuthRoutes(app, { postgres, withTransaction }) {
  async function requireCustomer(request, reply) {
    const context = await loadContext(postgres, sessionTokenFromRequest(request));
    if (!context) {
      return reply.code(401).send({
        error: 'customer_session_required',
        message: 'Sign in to continue.'
      });
    }
    request.customer = context;
  }

  app.post('/api/v1/auth/signup', async (request, reply) => {
    const email = normalizeEmail(request.body?.email);
    const displayName = normalizeDisplayName(request.body?.name);
    const companyName = normalizeDisplayName(request.body?.companyName).slice(0, 120);
    const password = String(request.body?.password ?? '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || displayName.length < 2 || companyName.length < 2 || !validatePassword(password)) {
      return reply.code(400).send({
        error: 'invalid_signup',
        message: 'Enter a valid name, work email, company name, and a password of at least 10 characters.'
      });
    }

    const passwordHash = await hashPassword(password);
    try {
      const created = await withTransaction(async (client) => {
        const userResult = await client.query(
          `INSERT INTO app_users(email, display_name, password_hash)
           VALUES ($1, $2, $3)
           RETURNING id, email, display_name`,
          [email, displayName, passwordHash]
        );
        const user = userResult.rows[0];
        const baseSlug = slugifyWorkspace(companyName) || 'company';
        const slug = `${baseSlug}-${randomBytes(4).toString('hex')}`;
        const workspaceResult = await client.query(
          `INSERT INTO workspaces(name, slug)
           VALUES ($1, $2)
           RETURNING id, name, slug, status`,
          [companyName, slug]
        );
        const workspace = workspaceResult.rows[0];
        await client.query(
          `INSERT INTO workspace_memberships(user_id, workspace_id, role)
           VALUES ($1, $2, 'owner')`,
          [user.id, workspace.id]
        );
        return { user, workspace };
      });
      const sessionToken = await createSession(postgres, created.user.id, request);
      return reply.code(201).send({
        sessionToken,
        user: { id: created.user.id, email: created.user.email, displayName: created.user.display_name },
        workspaces: [{ ...created.workspace, role: 'owner', portalId: null, hubspotStatus: null }]
      });
    } catch (error) {
      if (error.code === '23505') {
        return reply.code(409).send({ error: 'email_exists', message: 'An account already exists for this email.' });
      }
      throw error;
    }
  });

  app.post('/api/v1/auth/login', async (request, reply) => {
    const email = normalizeEmail(request.body?.email);
    const password = String(request.body?.password ?? '');
    const result = await postgres.query(
      `SELECT id, email, display_name, password_hash
       FROM app_users WHERE email = $1 AND status = 'active' LIMIT 1`,
      [email]
    );
    const user = result.rows[0];
    if (!user || !await verifyPassword(password, user.password_hash)) {
      return reply.code(401).send({ error: 'invalid_credentials', message: 'Email or password is incorrect.' });
    }
    await postgres.query('UPDATE app_users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    const sessionToken = await createSession(postgres, user.id, request);
    const context = await loadContext(postgres, sessionToken, { touch: false });
    return { sessionToken, user: context.user, workspaces: context.workspaces };
  });

  app.get('/api/v1/auth/session', { preHandler: requireCustomer }, async (request) => ({
    user: request.customer.user,
    workspaces: request.customer.workspaces
  }));

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const token = sessionTokenFromRequest(request);
    if (token) await postgres.query('DELETE FROM user_sessions WHERE token_hash = $1', [hashValue(token)]);
    return reply.code(204).send();
  });

  return {
    requireCustomer,
    loadContext: (token) => loadContext(postgres, token)
  };
}
