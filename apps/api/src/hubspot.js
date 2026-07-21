import { config, getHubSpotConfigurationStatus } from './config.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import { postgres } from './database.js';

export class HubSpotApiError extends Error {
  constructor(message, { statusCode = 500, category = 'HUBSPOT_API_ERROR', details } = {}) {
    super(message);
    this.name = 'HubSpotApiError';
    this.statusCode = statusCode;
    this.category = category;
    this.details = details;
  }
}

function assertHubSpotConfigured() {
  const status = getHubSpotConfigurationStatus();

  if (!status.configured) {
    throw new HubSpotApiError(
      `HubSpot integration is not configured: ${status.missing.join(', ')}`,
      { statusCode: 503, category: 'HUBSPOT_NOT_CONFIGURED', details: status }
    );
  }
}

async function parseResponse(response) {
  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    throw new HubSpotApiError(
      payload?.message ?? `HubSpot request failed with status ${response.status}`,
      {
        statusCode: response.status,
        category: payload?.category ?? 'HUBSPOT_API_ERROR',
        details: payload
      }
    );
  }

  return payload;
}

async function postTokenForm(values) {
  assertHubSpotConfigured();

  const response = await fetch(config.hubspot.tokenUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(values),
    signal: AbortSignal.timeout(20_000)
  });

  return parseResponse(response);
}

export function createAuthorizationUrl(state) {
  assertHubSpotConfigured();

  const url = new URL(config.hubspot.authorizationUrl);
  url.searchParams.set('client_id', config.hubspot.clientId);
  url.searchParams.set('redirect_uri', config.hubspot.redirectUri);
  url.searchParams.set('scope', config.hubspot.scopes.join(' '));
  url.searchParams.set('state', state);

  if (config.hubspot.optionalScopes.length > 0) {
    url.searchParams.set('optional_scope', config.hubspot.optionalScopes.join(' '));
  }

  return url.toString();
}

export async function exchangeAuthorizationCode(code) {
  return postTokenForm({
    grant_type: 'authorization_code',
    client_id: config.hubspot.clientId,
    client_secret: config.hubspot.clientSecret,
    redirect_uri: config.hubspot.redirectUri,
    code
  });
}

export async function refreshOAuthToken(refreshToken) {
  return postTokenForm({
    grant_type: 'refresh_token',
    client_id: config.hubspot.clientId,
    client_secret: config.hubspot.clientSecret,
    refresh_token: refreshToken
  });
}

export async function hubSpotGet(path, accessToken, query = {}) {
  const url = new URL(path, config.hubspot.apiBaseUrl);

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json'
    },
    signal: AbortSignal.timeout(30_000)
  });

  return parseResponse(response);
}

export async function getConnectionForWorkspace(workspaceId) {
  const result = await postgres.query(
    `
      SELECT *
      FROM hubspot_connections
      WHERE workspace_id = $1 AND status <> 'disconnected'
      LIMIT 1
    `,
    [workspaceId]
  );

  return result.rows[0] ?? null;
}

export async function getValidAccessToken(connection) {
  assertHubSpotConfigured();

  const expiresAt = new Date(connection.token_expires_at).getTime();
  const shouldRefresh = expiresAt - Date.now() < 120_000;

  if (!shouldRefresh) {
    return decryptSecret(connection.access_token_encrypted);
  }

  const currentRefreshToken = decryptSecret(connection.refresh_token_encrypted);
  const refreshed = await refreshOAuthToken(currentRefreshToken);
  const nextRefreshToken = refreshed.refresh_token ?? currentRefreshToken;
  const expiresIn = Number(refreshed.expires_in ?? 1800);
  const nextExpiry = new Date(Date.now() + expiresIn * 1000);

  await postgres.query(
    `
      UPDATE hubspot_connections
      SET access_token_encrypted = $2,
          refresh_token_encrypted = $3,
          token_expires_at = $4,
          scopes = $5::jsonb,
          status = 'connected',
          last_error = NULL,
          updated_at = NOW()
      WHERE id = $1
    `,
    [
      connection.id,
      encryptSecret(refreshed.access_token),
      encryptSecret(nextRefreshToken),
      nextExpiry,
      JSON.stringify(refreshed.scopes ?? connection.scopes ?? [])
    ]
  );

  return refreshed.access_token;
}
