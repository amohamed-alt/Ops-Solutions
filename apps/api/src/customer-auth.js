import { promisify } from 'node:util';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

import { hashValue, randomToken } from './crypto.js';

const scrypt = promisify(scryptCallback);
const SESSION_DAYS = 30;
const INVITATION_DAYS = 7;
const PASSWORD_RESET_MINUTES = 30;
const PASSWORD_KEY_LENGTH = 64;
const WORKSPACE_ROLES = new Set(['owner', 'admin', 'viewer']);
const ROLE_WEIGHT = Object.freeze({ viewer: 10, admin: 20, owner: 30 });

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

export function normalizeWorkspaceRole(value, fallback = 'viewer') {
  const role = String(value ?? '').trim().toLowerCase();
  return WORKSPACE_ROLES.has(role) ? role : fallback;
}

export function hasWorkspaceRole(actualRole, minimumRole) {
  return Number(ROLE_WEIGHT[actualRole] ?? 0) >= Number(ROLE_WEIGHT[minimumRole] ?? Number.MAX_SAFE_INTEGER);
}

export async function hashPassword(password) {
  if (!validatePassword(password)) throw new TypeError('Password must be between 10 and 200 characters.');
  const salt = randomBytes(16);
  const derived = await scrypt(String(password), salt, PASSWORD_KEY_LENGTH);
  return `scrypt-v1.${salt.toString('base64url')}.${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  try {
    const [version, saltValue, encodedHash] = String(encoded ?? '').split('.');
    if (version !== 'scrypt-v1' || !saltValue || !encodedHash) return false;
    const expected = Buffer.from(encodedHash, 'base64url');
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
      role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'viewer')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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

    CREATE TABLE IF NOT EXISTS workspace_invitations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
      token_hash CHAR(64) NOT NULL UNIQUE,
      invited_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
      accepted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
      actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      ip_hash CHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS workspace_memberships_workspace_idx
      ON workspace_memberships(workspace_id, role);
    CREATE INDEX IF NOT EXISTS user_sessions_user_expiry_idx
      ON user_sessions(user_id, expires_at DESC);
    CREATE INDEX IF NOT EXISTS user_sessions_expiry_idx
      ON user_sessions(expires_at);
    CREATE UNIQUE INDEX IF NOT EXISTS workspace_invitations_pending_email_idx
      ON workspace_invitations(workspace_id, email)
      WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS workspace_invitations_expiry_idx
      ON workspace_invitations(expires_at, status);
    CREATE INDEX IF NOT EXISTS password_reset_tokens_user_expiry_idx
      ON password_reset_tokens(user_id, expires_at DESC);
    CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry_idx
      ON password_reset_tokens(expires_at)
      WHERE used_at IS NULL;
    CREATE INDEX IF NOT EXISTS audit_events_workspace_created_idx
      ON audit_events(workspace_id, created_at DESC);

    ALTER TABLE workspace_memberships
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
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

async function writeAudit(postgres, request, {
  workspaceId = null,
  actorUserId = null,
  action,
  targetType = null,
  targetId = null,
  metadata = {}
}) {
  const ipHash = request.ip ? hashValue(request.ip) : null;
  await postgres.query(
    `INSERT INTO audit_events(workspace_id, actor_user_id, action, target_type, target_id, metadata, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [workspaceId, actorUserId, action, targetType, targetId, JSON.stringify(metadata), ipHash]
  );
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

async function ensureLastOwnerIsPreserved(postgres, workspaceId, targetUserId, nextRole = null) {
  const targetResult = await postgres.query(
    `SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
    [workspaceId, targetUserId]
  );
  if (targetResult.rowCount === 0) return;
  if (targetResult.rows[0].role !== 'owner' || nextRole === 'owner') return;
  const ownersResult = await postgres.query(
    `SELECT COUNT(*)::int AS count FROM workspace_memberships WHERE workspace_id = $1 AND role = 'owner'`,
    [workspaceId]
  );
  if (Number(ownersResult.rows[0].count) <= 1) {
    const error = new Error('A workspace must always have at least one owner.');
    error.statusCode = 409;
    error.category = 'LAST_OWNER_REQUIRED';
    throw error;
  }
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

  async function requireWorkspaceRole(request, reply, minimumRole = 'viewer') {
    const workspaceId = String(request.params?.workspaceId ?? '');
    const membership = request.customer?.workspaces?.find((workspace) => workspace.id === workspaceId);
    if (!membership) {
      return reply.code(403).send({ error: 'workspace_forbidden', message: 'This workspace is not available to your account.' });
    }
    if (!hasWorkspaceRole(membership.role, minimumRole)) {
      return reply.code(403).send({ error: 'workspace_role_required', message: `${minimumRole} access is required.` });
    }
    request.workspaceMembership = membership;
  }

  const requireViewer = [requireCustomer, (request, reply) => requireWorkspaceRole(request, reply, 'viewer')];
  const requireAdmin = [requireCustomer, (request, reply) => requireWorkspaceRole(request, reply, 'admin')];
  const requireOwner = [requireCustomer, (request, reply) => requireWorkspaceRole(request, reply, 'owner')];

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
      await writeAudit(postgres, request, {
        workspaceId: created.workspace.id,
        actorUserId: created.user.id,
        action: 'workspace.created',
        targetType: 'workspace',
        targetId: created.workspace.id,
        metadata: { companyName: created.workspace.name }
      });
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

  app.post('/api/v1/auth/password-reset/request', async (request) => {
    const email = normalizeEmail(request.body?.email);
    const generic = {
      status: 'accepted',
      message: 'If an active account exists for this email, password reset instructions will be sent.'
    };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return generic;

    const result = await postgres.query(
      `SELECT id, email FROM app_users WHERE email = $1 AND status = 'active' LIMIT 1`,
      [email]
    );
    const user = result.rows[0];
    if (!user) return generic;

    const token = randomToken(40);
    await postgres.query(
      `INSERT INTO password_reset_tokens(user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + ($3::int * INTERVAL '1 minute'))`,
      [user.id, hashValue(token), PASSWORD_RESET_MINUTES]
    );
    await writeAudit(postgres, request, {
      actorUserId: user.id,
      action: 'auth.password_reset_requested',
      targetType: 'user',
      targetId: user.id,
      metadata: { email }
    });

    return {
      ...generic,
      resetPath: process.env.NODE_ENV === 'production' ? undefined : `/onboarding?resetToken=${token}`
    };
  });

  app.post('/api/v1/auth/password-reset/confirm', async (request, reply) => {
    const token = String(request.body?.token ?? '').trim();
    const password = String(request.body?.password ?? '');
    if (token.length < 20 || !validatePassword(password)) {
      return reply.code(400).send({
        error: 'invalid_password_reset',
        message: 'Enter a valid reset token and a password of at least 10 characters.'
      });
    }

    const tokenHash = hashValue(token);
    const passwordHash = await hashPassword(password);
    const reset = await withTransaction(async (client) => {
      const tokenResult = await client.query(
        `SELECT id, user_id
         FROM password_reset_tokens
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
         LIMIT 1
         FOR UPDATE`,
        [tokenHash]
      );
      const tokenRow = tokenResult.rows[0];
      if (!tokenRow) return null;
      await client.query(
        `UPDATE app_users SET password_hash = $2, updated_at = NOW()
         WHERE id = $1 AND status = 'active'`,
        [tokenRow.user_id, passwordHash]
      );
      await client.query(
        `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`,
        [tokenRow.id]
      );
      await client.query(
        `DELETE FROM user_sessions WHERE user_id = $1`,
        [tokenRow.user_id]
      );
      return tokenRow;
    });

    if (!reset) {
      return reply.code(410).send({
        error: 'password_reset_unavailable',
        message: 'This password reset link is invalid or expired.'
      });
    }

    await writeAudit(postgres, request, {
      actorUserId: reset.user_id,
      action: 'auth.password_reset_completed',
      targetType: 'user',
      targetId: reset.user_id
    });
    return { status: 'reset' };
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

  app.post('/api/v1/auth/invitations/:token/accept', { preHandler: requireCustomer }, async (request, reply) => {
    const invitationToken = String(request.params.token ?? '').trim();
    const tokenHash = hashValue(invitationToken);
    const invitationResult = await postgres.query(
      `SELECT id, workspace_id, email, role, status, expires_at
       FROM workspace_invitations
       WHERE token_hash = $1
       LIMIT 1`,
      [tokenHash]
    );
    const invitation = invitationResult.rows[0];
    if (!invitation || invitation.status !== 'pending' || new Date(invitation.expires_at).getTime() <= Date.now()) {
      return reply.code(410).send({ error: 'invitation_unavailable', message: 'This invitation is invalid, expired, or already used.' });
    }
    if (normalizeEmail(invitation.email) !== normalizeEmail(request.customer.user.email)) {
      return reply.code(403).send({ error: 'invitation_email_mismatch', message: 'Sign in with the email address that received this invitation.' });
    }
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO workspace_memberships(user_id, workspace_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, workspace_id) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`,
        [request.customer.user.id, invitation.workspace_id, invitation.role]
      );
      await client.query(
        `UPDATE workspace_invitations
         SET status = 'accepted', accepted_by = $2, accepted_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [invitation.id, request.customer.user.id]
      );
    });
    await writeAudit(postgres, request, {
      workspaceId: invitation.workspace_id,
      actorUserId: request.customer.user.id,
      action: 'member.invitation_accepted',
      targetType: 'user',
      targetId: request.customer.user.id,
      metadata: { role: invitation.role }
    });
    return { status: 'accepted', workspaceId: invitation.workspace_id, role: invitation.role };
  });

  app.get('/api/v1/customer/workspaces/:workspaceId/members', { preHandler: requireViewer }, async (request) => {
    const result = await postgres.query(
      `SELECT u.id, u.email, u.display_name, u.status, m.role, m.created_at, m.updated_at
       FROM workspace_memberships m
       JOIN app_users u ON u.id = m.user_id
       WHERE m.workspace_id = $1
       ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.display_name`,
      [request.params.workspaceId]
    );
    return { results: result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      status: row.status,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })) };
  });

  app.get('/api/v1/customer/workspaces/:workspaceId/invitations', { preHandler: requireAdmin }, async (request) => {
    await postgres.query(
      `UPDATE workspace_invitations SET status = 'expired', updated_at = NOW()
       WHERE workspace_id = $1 AND status = 'pending' AND expires_at <= NOW()`,
      [request.params.workspaceId]
    );
    const result = await postgres.query(
      `SELECT id, email, role, status, expires_at, created_at
       FROM workspace_invitations
       WHERE workspace_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [request.params.workspaceId]
    );
    return { results: result.rows };
  });

  app.post('/api/v1/customer/workspaces/:workspaceId/invitations', { preHandler: requireAdmin }, async (request, reply) => {
    const email = normalizeEmail(request.body?.email);
    const role = normalizeWorkspaceRole(request.body?.role, 'viewer');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['admin', 'viewer'].includes(role)) {
      return reply.code(400).send({ error: 'invalid_invitation', message: 'Enter a valid email and choose admin or viewer access.' });
    }
    const existingMember = await postgres.query(
      `SELECT 1 FROM workspace_memberships m JOIN app_users u ON u.id = m.user_id
       WHERE m.workspace_id = $1 AND u.email = $2 LIMIT 1`,
      [request.params.workspaceId, email]
    );
    if (existingMember.rowCount > 0) {
      return reply.code(409).send({ error: 'already_member', message: 'This person is already a workspace member.' });
    }
    const token = randomToken(32);
    const result = await postgres.query(
      `INSERT INTO workspace_invitations(workspace_id, email, role, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + ($6::int * INTERVAL '1 day'))
       ON CONFLICT (workspace_id, email) WHERE status = 'pending'
       DO UPDATE SET role = EXCLUDED.role, token_hash = EXCLUDED.token_hash,
                     invited_by = EXCLUDED.invited_by, expires_at = EXCLUDED.expires_at, updated_at = NOW()
       RETURNING id, email, role, status, expires_at, created_at`,
      [request.params.workspaceId, email, role, hashValue(token), request.customer.user.id, INVITATION_DAYS]
    );
    await writeAudit(postgres, request, {
      workspaceId: request.params.workspaceId,
      actorUserId: request.customer.user.id,
      action: 'member.invited',
      targetType: 'email',
      targetId: email,
      metadata: { role }
    });
    return reply.code(201).send({
      ...result.rows[0],
      invitationToken: token,
      acceptPath: `/invite/${token}`
    });
  });

  app.delete('/api/v1/customer/workspaces/:workspaceId/invitations/:invitationId', { preHandler: requireAdmin }, async (request, reply) => {
    const result = await postgres.query(
      `UPDATE workspace_invitations
       SET status = 'revoked', updated_at = NOW()
       WHERE id = $1 AND workspace_id = $2 AND status = 'pending'
       RETURNING id, email, role`,
      [request.params.invitationId, request.params.workspaceId]
    );
    if (result.rowCount === 0) return reply.code(404).send({ error: 'invitation_not_found', message: 'Pending invitation not found.' });
    await writeAudit(postgres, request, {
      workspaceId: request.params.workspaceId,
      actorUserId: request.customer.user.id,
      action: 'member.invitation_revoked',
      targetType: 'email',
      targetId: result.rows[0].email,
      metadata: { role: result.rows[0].role }
    });
    return reply.code(204).send();
  });

  app.patch('/api/v1/customer/workspaces/:workspaceId/members/:userId', { preHandler: requireOwner }, async (request, reply) => {
    const role = normalizeWorkspaceRole(request.body?.role, '');
    if (!WORKSPACE_ROLES.has(role)) {
      return reply.code(400).send({ error: 'invalid_role', message: 'Role must be owner, admin, or viewer.' });
    }
    await ensureLastOwnerIsPreserved(postgres, request.params.workspaceId, request.params.userId, role);
    const result = await postgres.query(
      `UPDATE workspace_memberships SET role = $3, updated_at = NOW()
       WHERE workspace_id = $1 AND user_id = $2
       RETURNING user_id, role, updated_at`,
      [request.params.workspaceId, request.params.userId, role]
    );
    if (result.rowCount === 0) return reply.code(404).send({ error: 'member_not_found', message: 'Workspace member not found.' });
    await writeAudit(postgres, request, {
      workspaceId: request.params.workspaceId,
      actorUserId: request.customer.user.id,
      action: 'member.role_changed',
      targetType: 'user',
      targetId: request.params.userId,
      metadata: { role }
    });
    return result.rows[0];
  });

  app.delete('/api/v1/customer/workspaces/:workspaceId/members/:userId', { preHandler: requireOwner }, async (request, reply) => {
    await ensureLastOwnerIsPreserved(postgres, request.params.workspaceId, request.params.userId, null);
    const result = await postgres.query(
      `DELETE FROM workspace_memberships
       WHERE workspace_id = $1 AND user_id = $2
       RETURNING user_id, role`,
      [request.params.workspaceId, request.params.userId]
    );
    if (result.rowCount === 0) return reply.code(404).send({ error: 'member_not_found', message: 'Workspace member not found.' });
    await writeAudit(postgres, request, {
      workspaceId: request.params.workspaceId,
      actorUserId: request.customer.user.id,
      action: 'member.removed',
      targetType: 'user',
      targetId: request.params.userId,
      metadata: { previousRole: result.rows[0].role }
    });
    return reply.code(204).send();
  });

  app.get('/api/v1/customer/workspaces/:workspaceId/audit', { preHandler: requireAdmin }, async (request) => {
    const limit = Math.min(Math.max(Number(request.query?.limit ?? 50), 1), 200);
    const before = String(request.query?.before ?? '').trim();
    const values = [request.params.workspaceId, limit];
    const cursorFilter = before ? 'AND e.created_at < $3::timestamptz' : '';
    if (before) values.push(before);
    const result = await postgres.query(
      `SELECT e.id, e.action, e.target_type, e.target_id, e.metadata, e.created_at,
              u.email AS actor_email, u.display_name AS actor_name
       FROM audit_events e
       LEFT JOIN app_users u ON u.id = e.actor_user_id
       WHERE e.workspace_id = $1 ${cursorFilter}
       ORDER BY e.created_at DESC
       LIMIT $2`,
      values
    );
    return {
      results: result.rows,
      nextCursor: result.rows.length === limit ? result.rows.at(-1)?.created_at ?? null : null
    };
  });

  return {
    requireCustomer,
    requireWorkspaceRole,
    requireViewer,
    requireAdmin,
    requireOwner,
    loadContext: (token) => loadContext(postgres, token),
    writeAudit: (request, event) => writeAudit(postgres, request, event)
  };
}
