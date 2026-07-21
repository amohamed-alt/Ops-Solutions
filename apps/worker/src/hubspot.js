import { setTimeout as delay } from 'node:timers/promises';

import { config, assertHubSpotWorkerConfiguration } from './config.js';
import { decryptSecret, encryptSecret } from './crypto.js';

export class HubSpotWorkerError extends Error {
  constructor(message, { statusCode = 500, category = 'HUBSPOT_WORKER_ERROR', details } = {}) {
    super(message);
    this.name = 'HubSpotWorkerError';
    this.statusCode = statusCode;
    this.category = category;
    this.details = details;
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
    throw new HubSpotWorkerError(
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

async function tokenRequest(values) {
  assertHubSpotWorkerConfiguration();

  const response = await fetch(config.hubspot.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values),
    signal: AbortSignal.timeout(20_000)
  });

  return parseResponse(response);
}

export async function getConnection(postgres, workspaceId) {
  const result = await postgres.query(
    `
      SELECT *
      FROM hubspot_connections
      WHERE workspace_id = $1 AND status <> 'disconnected'
      LIMIT 1
    `,
    [workspaceId]
  );

  if (result.rowCount === 0) {
    throw new HubSpotWorkerError('No active HubSpot connection exists for this workspace', {
      statusCode: 404,
      category: 'HUBSPOT_CONNECTION_NOT_FOUND'
    });
  }

  return result.rows[0];
}

export async function getValidAccessToken(postgres, connection) {
  assertHubSpotWorkerConfiguration();

  const expiresAt = new Date(connection.token_expires_at).getTime();
  if (expiresAt - Date.now() >= 120_000) {
    return decryptSecret(connection.access_token_encrypted);
  }

  const currentRefreshToken = decryptSecret(connection.refresh_token_encrypted);
  const refreshed = await tokenRequest({
    grant_type: 'refresh_token',
    client_id: config.hubspot.clientId,
    client_secret: config.hubspot.clientSecret,
    refresh_token: currentRefreshToken
  });

  if (!refreshed?.access_token) {
    throw new HubSpotWorkerError('HubSpot returned an incomplete refresh response', {
      statusCode: 502,
      category: 'INVALID_TOKEN_RESPONSE'
    });
  }

  const nextRefreshToken = refreshed.refresh_token ?? currentRefreshToken;
  const nextExpiry = new Date(Date.now() + Number(refreshed.expires_in ?? 1800) * 1000);

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

function retryDelayMs(response, attempt) {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(60_000, retryAfter * 1000);
  }

  return Math.min(30_000, 750 * (2 ** attempt) + Math.floor(Math.random() * 500));
}

export async function hubSpotRequest(path, accessToken, {
  method = 'GET',
  query = {},
  body,
  maxAttempts = 5
} = {}) {
  const url = new URL(path, config.hubspot.apiBaseUrl);

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      await delay(config.hubspot.requestDelayMs);
    }

    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: 'application/json',
          ...(body ? { 'content-type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000)
      });
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts - 1) throw error;
      await delay(Math.min(30_000, 750 * (2 ** attempt)));
      continue;
    }

    if (response.ok) {
      return parseResponse(response);
    }

    if ((response.status === 429 || response.status >= 500) && attempt < maxAttempts - 1) {
      await delay(retryDelayMs(response, attempt));
      continue;
    }

    return parseResponse(response);
  }

  throw lastError ?? new HubSpotWorkerError('HubSpot request failed after retries');
}
