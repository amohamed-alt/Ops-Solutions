import { registerAccountSecurityRoutes } from './account-security.js';
import { registerPasswordRecoveryRoutes } from './password-recovery.js';

const DEFAULTS = Object.freeze({
  currency: 'USD',
  timezone: 'UTC',
  locale: 'en-US',
  appearance: 'system',
  accentColor: '#0f766e',
  logoUrl: null
});

const APPEARANCES = new Set(['system', 'light', 'dark']);
const WRITER_ROLES = new Set(['owner', 'admin']);
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

export function normalizeWorkspacePreferences(input = {}) {
  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const currency = String(input.currency ?? DEFAULTS.currency).trim().toUpperCase();
  const timezone = String(input.timezone ?? DEFAULTS.timezone).trim().slice(0, 100);
  const locale = String(input.locale ?? DEFAULTS.locale).trim().slice(0, 20);
  const appearance = String(input.appearance ?? DEFAULTS.appearance).trim().toLowerCase();
  const accentColor = String(input.accentColor ?? DEFAULTS.accentColor).trim().toLowerCase();
  const logoUrlRaw = String(input.logoUrl ?? '').trim();
  const logoUrl = logoUrlRaw ? logoUrlRaw.slice(0, 500) : null;

  if (name && name.length < 2) throw preferenceError('Workspace name must be between 2 and 120 characters.');
  if (!CURRENCY_PATTERN.test(currency)) throw preferenceError('Currency must be a three-letter ISO code.');
  if (!LOCALE_PATTERN.test(locale)) throw preferenceError('Locale must use a supported language or language-region format.');
  if (!APPEARANCES.has(appearance)) throw preferenceError('Appearance must be system, light, or dark.');
  if (!HEX_PATTERN.test(accentColor)) throw preferenceError('Accent color must be a six-digit hex color.');
  try {
    new Intl.DateTimeFormat(locale, { timeZone: timezone }).format(new Date());
  } catch {
    throw preferenceError('Timezone or locale is not supported by this runtime.');
  }
  if (logoUrl) {
    let parsed;
    try { parsed = new URL(logoUrl); } catch { throw preferenceError('Logo URL must be a valid HTTPS URL.'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw preferenceError('Logo URL must be a credential-free HTTPS URL.');
    }
  }

  return { name: name || null, currency, timezone, locale, appearance, accentColor, logoUrl };
}

function preferenceError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.category = 'INVALID_WORKSPACE_PREFERENCES';
  return error;
}

export async function ensureWorkspacePreferencesSchema(postgres) {
  await postgres.query(`
    CREATE TABLE IF NOT EXISTS workspace_preferences (
      workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
      currency CHAR(3) NOT NULL DEFAULT 'USD',
      timezone TEXT NOT NULL DEFAULT 'UTC',
      locale TEXT NOT NULL DEFAULT 'en-US',
      appearance TEXT NOT NULL DEFAULT 'system' CHECK (appearance IN ('system','light','dark')),
      accent_color CHAR(7) NOT NULL DEFAULT '#0f766e',
      logo_url TEXT,
      updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (currency ~ '^[A-Z]{3}$'),
      CHECK (accent_color ~ '^#[0-9a-fA-F]{6}$')
    );
    CREATE INDEX IF NOT EXISTS workspace_preferences_updated_idx
      ON workspace_preferences(updated_at DESC);
  `);
}

function serialize(row) {
  return {
    workspaceId: row.workspace_id,
    name: row.name,
    slug: row.slug,
    currency: row.currency || DEFAULTS.currency,
    timezone: row.timezone || DEFAULTS.timezone,
    locale: row.locale || DEFAULTS.locale,
    appearance: row.appearance || DEFAULTS.appearance,
    accentColor: row.accent_color || DEFAULTS.accentColor,
    logoUrl: row.logo_url || null,
    updatedAt: row.preferences_updated_at || row.updated_at || null
  };
}

export function registerWorkspacePreferencesRoutes(app, { postgres, withTransaction, requireViewer, writeAudit }) {
  const schemaReady = ensureWorkspacePreferencesSchema(postgres);
  const basePath = '/api/v1/customer/workspaces/:workspaceId/preferences';

  registerPasswordRecoveryRoutes(app, { postgres, withTransaction });
  registerAccountSecurityRoutes(app, { postgres });

  app.get(basePath, { preHandler: requireViewer }, async (request) => {
    await schemaReady;
    const result = await postgres.query(`
      SELECT w.id AS workspace_id, w.name, w.slug, w.updated_at,
             p.currency, p.timezone, p.locale, p.appearance, p.accent_color,
             p.logo_url, p.updated_at AS preferences_updated_at
      FROM workspaces w
      LEFT JOIN workspace_preferences p ON p.workspace_id = w.id
      WHERE w.id = $1
      LIMIT 1
    `, [request.params.workspaceId]);
    if (result.rowCount === 0) {
      const error = new Error('Workspace not found.');
      error.statusCode = 404;
      throw error;
    }
    return serialize(result.rows[0]);
  });

  app.put(basePath, { preHandler: requireViewer }, async (request, reply) => {
    if (!WRITER_ROLES.has(request.workspaceMembership?.role)) {
      return reply.code(403).send({
        error: 'workspace_role_required',
        message: 'Admin access is required to update workspace preferences.'
      });
    }
    await schemaReady;
    const input = normalizeWorkspacePreferences(request.body);
    const workspaceId = request.params.workspaceId;
    const actorUserId = request.customer.user.id;
    const result = await withTransaction(async (client) => {
      if (input.name) {
        await client.query('UPDATE workspaces SET name = $2, updated_at = NOW() WHERE id = $1', [workspaceId, input.name]);
      }
      await client.query(`
        INSERT INTO workspace_preferences (
          workspace_id, currency, timezone, locale, appearance,
          accent_color, logo_url, updated_by, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
        ON CONFLICT (workspace_id) DO UPDATE SET
          currency = EXCLUDED.currency,
          timezone = EXCLUDED.timezone,
          locale = EXCLUDED.locale,
          appearance = EXCLUDED.appearance,
          accent_color = EXCLUDED.accent_color,
          logo_url = EXCLUDED.logo_url,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
      `, [workspaceId, input.currency, input.timezone, input.locale, input.appearance, input.accentColor, input.logoUrl, actorUserId]);
      return client.query(`
        SELECT w.id AS workspace_id, w.name, w.slug, w.updated_at,
               p.currency, p.timezone, p.locale, p.appearance, p.accent_color,
               p.logo_url, p.updated_at AS preferences_updated_at
        FROM workspaces w JOIN workspace_preferences p ON p.workspace_id = w.id
        WHERE w.id = $1
      `, [workspaceId]);
    });
    await writeAudit(request, {
      workspaceId,
      actorUserId,
      action: 'workspace.preferences_updated',
      targetType: 'workspace',
      targetId: workspaceId,
      metadata: {
        currency: input.currency,
        timezone: input.timezone,
        locale: input.locale,
        appearance: input.appearance,
        accentColor: input.accentColor,
        hasLogo: Boolean(input.logoUrl),
        renamed: Boolean(input.name)
      }
    });
    return serialize(result.rows[0]);
  });
}
