const CURRENCIES = new Set(['USD','EUR','GBP','AED','SAR','EGP','QAR','KWD','BHD','OMR']);
const LOCALES = new Set(['en-US','en-GB','ar-EG','ar-SA','ar-AE']);
const APPEARANCES = new Set(['light','dark','system']);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function normalizeWorkspacePreferences(input = {}) {
  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const currency = String(input.currency ?? 'USD').trim().toUpperCase();
  const locale = String(input.locale ?? 'en-US').trim();
  const timezone = String(input.timezone ?? 'UTC').trim().slice(0, 100);
  const accentColor = String(input.accentColor ?? '#0f766e').trim();
  const appearance = String(input.appearance ?? 'light').trim().toLowerCase();
  const logoUrl = String(input.logoUrl ?? '').trim().slice(0, 500);

  if (name.length < 2) throw Object.assign(new Error('Company name must be between 2 and 120 characters.'), { statusCode: 400, category: 'INVALID_COMPANY_NAME' });
  if (!CURRENCIES.has(currency)) throw Object.assign(new Error('Choose a supported currency.'), { statusCode: 400, category: 'INVALID_CURRENCY' });
  if (!LOCALES.has(locale)) throw Object.assign(new Error('Choose a supported locale.'), { statusCode: 400, category: 'INVALID_LOCALE' });
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date()); }
  catch { throw Object.assign(new Error('Choose a valid IANA timezone.'), { statusCode: 400, category: 'INVALID_TIMEZONE' }); }
  if (!HEX_COLOR.test(accentColor)) throw Object.assign(new Error('Accent color must be a six-digit hex color.'), { statusCode: 400, category: 'INVALID_ACCENT_COLOR' });
  if (!APPEARANCES.has(appearance)) throw Object.assign(new Error('Appearance must be light, dark, or system.'), { statusCode: 400, category: 'INVALID_APPEARANCE' });
  if (logoUrl && !/^https:\/\//i.test(logoUrl)) throw Object.assign(new Error('Logo URL must use HTTPS.'), { statusCode: 400, category: 'INVALID_LOGO_URL' });

  return { name, currency, locale, timezone, accentColor: accentColor.toLowerCase(), appearance, logoUrl: logoUrl || null };
}

export async function ensureWorkspacePreferencesSchema(postgres) {
  await postgres.query(`
    CREATE TABLE IF NOT EXISTS workspace_preferences (
      workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
      currency TEXT NOT NULL DEFAULT 'USD',
      locale TEXT NOT NULL DEFAULT 'en-US',
      timezone TEXT NOT NULL DEFAULT 'UTC',
      accent_color TEXT NOT NULL DEFAULT '#0f766e',
      appearance TEXT NOT NULL DEFAULT 'light',
      logo_url TEXT,
      updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (appearance IN ('light','dark','system'))
    );
    CREATE INDEX IF NOT EXISTS workspace_preferences_updated_idx
      ON workspace_preferences(updated_at DESC);
  `);
}

function publicPreferences(row) {
  return {
    workspaceId: row.workspace_id,
    name: row.name,
    currency: row.currency,
    locale: row.locale,
    timezone: row.timezone,
    accentColor: row.accent_color,
    appearance: row.appearance,
    logoUrl: row.logo_url,
    updatedAt: row.updated_at
  };
}

export function registerWorkspacePreferencesRoutes(app, { postgres, withTransaction, requireViewer, requireAdmin, writeAudit }) {
  app.get('/api/v1/customer/workspaces/:workspaceId/preferences', { preHandler: requireViewer }, async (request) => {
    const result = await postgres.query(`
      SELECT w.id AS workspace_id, w.name,
             COALESCE(p.currency, 'USD') AS currency,
             COALESCE(p.locale, 'en-US') AS locale,
             COALESCE(p.timezone, 'UTC') AS timezone,
             COALESCE(p.accent_color, '#0f766e') AS accent_color,
             COALESCE(p.appearance, 'light') AS appearance,
             p.logo_url, COALESCE(p.updated_at, w.updated_at) AS updated_at
      FROM workspaces w
      LEFT JOIN workspace_preferences p ON p.workspace_id = w.id
      WHERE w.id = $1
      LIMIT 1
    `, [request.params.workspaceId]);
    return publicPreferences(result.rows[0]);
  });

  app.put('/api/v1/customer/workspaces/:workspaceId/preferences', { preHandler: requireAdmin }, async (request) => {
    const preferences = normalizeWorkspacePreferences(request.body);
    const result = await withTransaction(async (client) => {
      const workspace = await client.query(
        `UPDATE workspaces SET name = $2, updated_at = NOW() WHERE id = $1 RETURNING id, name`,
        [request.params.workspaceId, preferences.name]
      );
      if (workspace.rowCount === 0) throw Object.assign(new Error('Workspace not found.'), { statusCode: 404 });
      const saved = await client.query(`
        INSERT INTO workspace_preferences (
          workspace_id, currency, locale, timezone, accent_color, appearance, logo_url, updated_by, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
        ON CONFLICT (workspace_id) DO UPDATE SET
          currency = EXCLUDED.currency,
          locale = EXCLUDED.locale,
          timezone = EXCLUDED.timezone,
          accent_color = EXCLUDED.accent_color,
          appearance = EXCLUDED.appearance,
          logo_url = EXCLUDED.logo_url,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
        RETURNING *
      `, [request.params.workspaceId, preferences.currency, preferences.locale, preferences.timezone, preferences.accentColor, preferences.appearance, preferences.logoUrl, request.customer.user.id]);
      return { ...saved.rows[0], name: workspace.rows[0].name };
    });
    await writeAudit(request, {
      workspaceId: request.params.workspaceId,
      action: 'workspace.preferences_updated',
      targetType: 'workspace',
      targetId: request.params.workspaceId,
      metadata: { currency: preferences.currency, locale: preferences.locale, timezone: preferences.timezone, appearance: preferences.appearance }
    });
    return publicPreferences(result);
  });
}
