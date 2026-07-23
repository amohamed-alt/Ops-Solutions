const DEFAULTS = Object.freeze({
  currency: 'USD',
  timezone: 'UTC',
  locale: 'en-US'
});

function safePreferences(row = {}) {
  const currency = /^[A-Z]{3}$/.test(String(row.currency ?? '')) ? String(row.currency) : DEFAULTS.currency;
  const timezone = String(row.timezone ?? DEFAULTS.timezone);
  const locale = String(row.locale ?? DEFAULTS.locale);
  try {
    new Intl.DateTimeFormat(locale, { timeZone: timezone }).format(new Date());
    new Intl.NumberFormat(locale, { style: 'currency', currency }).format(0);
    return { currency, timezone, locale };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function loadWorkspaceReportPreferences(postgres, workspaceId) {
  const result = await postgres.query(
    `SELECT currency, timezone, locale
     FROM workspace_preferences
     WHERE workspace_id = $1
     LIMIT 1`,
    [workspaceId]
  );
  return safePreferences(result.rows[0]);
}

export function formatReportCurrency(value, preferences) {
  const resolved = safePreferences(preferences);
  const numeric = Number(value ?? 0);
  return new Intl.NumberFormat(resolved.locale, {
    style: 'currency',
    currency: resolved.currency,
    currencyDisplay: 'code',
    maximumFractionDigits: 2
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

export function formatReportDateTime(value, preferences) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const resolved = safePreferences(preferences);
  return new Intl.DateTimeFormat(resolved.locale, {
    timeZone: resolved.timezone,
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

export function serializeReportPreferences(preferences) {
  return safePreferences(preferences);
}
