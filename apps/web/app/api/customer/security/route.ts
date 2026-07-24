import { NextRequest, NextResponse } from 'next/server';

import { API_URL, customerHeaders, getCustomerContext } from '../session';

async function readJson(response: Response) {
  return response.json().catch(() => ({}));
}

function noStore(status: number, body: unknown) {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'no-store, max-age=0' }
  });
}

export async function GET(request: NextRequest) {
  const context = await getCustomerContext(request);
  if (!context) return noStore(401, { error: 'session_required', message: 'Sign in to continue.' });

  try {
    const response = await fetch(`${API_URL}/api/v1/customer/security`, {
      headers: customerHeaders(request),
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000)
    });
    return noStore(response.status, await readJson(response));
  } catch (error) {
    return noStore(503, {
      error: 'account_security_unavailable',
      message: error instanceof Error ? error.message : 'Unable to load account security.'
    });
  }
}

export async function POST(request: NextRequest) {
  const context = await getCustomerContext(request);
  if (!context) return noStore(401, { error: 'session_required', message: 'Sign in to continue.' });

  const body = await request.json().catch(() => ({}));
  if (String(body.action ?? '').trim() !== 'trust_current_device') {
    return noStore(400, { error: 'invalid_security_action', message: 'Choose a supported device action.' });
  }

  try {
    const response = await fetch(`${API_URL}/api/v1/customer/security/devices/trust-current`, {
      method: 'POST', headers: customerHeaders(request), cache: 'no-store', signal: AbortSignal.timeout(12_000)
    });
    return noStore(response.status, await readJson(response));
  } catch (error) {
    return noStore(503, {
      error: 'device_trust_failed',
      message: error instanceof Error ? error.message : 'Unable to trust the current device.'
    });
  }
}

export async function PATCH(request: NextRequest) {
  const context = await getCustomerContext(request);
  if (!context) return noStore(401, { error: 'session_required', message: 'Sign in to continue.' });

  const body = await request.json().catch(() => ({}));
  const deviceId = String(body.deviceId ?? '').trim();
  const label = String(body.label ?? '').trim();
  if (String(body.action ?? '').trim() !== 'rename_device' || !/^[0-9a-f-]{36}$/i.test(deviceId)) {
    return noStore(400, { error: 'invalid_security_action', message: 'Choose a valid trusted device.' });
  }

  try {
    const response = await fetch(`${API_URL}/api/v1/customer/security/devices/${encodeURIComponent(deviceId)}`, {
      method: 'PATCH',
      headers: { ...customerHeaders(request), 'content-type': 'application/json' },
      body: JSON.stringify({ label }),
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000)
    });
    return noStore(response.status, await readJson(response));
  } catch (error) {
    return noStore(503, {
      error: 'device_rename_failed',
      message: error instanceof Error ? error.message : 'Unable to rename the trusted device.'
    });
  }
}

export async function DELETE(request: NextRequest) {
  const context = await getCustomerContext(request);
  if (!context) return noStore(401, { error: 'session_required', message: 'Sign in to continue.' });

  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? '').trim();
  const sessionId = String(body.sessionId ?? '').trim();
  const deviceId = String(body.deviceId ?? '').trim();
  let path = '/api/v1/customer/security/sessions';

  if (action === 'revoke_device') {
    if (!/^[0-9a-f-]{36}$/i.test(deviceId)) return noStore(400, { error: 'invalid_device_id', message: 'Trusted device ID is invalid.' });
    path = `/api/v1/customer/security/devices/${encodeURIComponent(deviceId)}`;
  } else if (action === 'revoke_session') {
    if (!/^[0-9a-f]{64}$/i.test(sessionId)) return noStore(400, { error: 'invalid_session_id', message: 'Session ID is invalid.' });
    path += `/${encodeURIComponent(sessionId)}`;
  } else if (action === 'revoke_stale') {
    path += '/stale?days=30';
  } else if (action !== 'revoke_others') {
    return noStore(400, { error: 'invalid_security_action', message: 'Choose a supported security action.' });
  }

  try {
    const response = await fetch(`${API_URL}${path}`, {
      method: 'DELETE', headers: customerHeaders(request), cache: 'no-store', signal: AbortSignal.timeout(12_000)
    });
    if (response.status === 204) return new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store, max-age=0' } });
    return noStore(response.status, await readJson(response));
  } catch (error) {
    return noStore(503, {
      error: action === 'revoke_device' ? 'device_revocation_failed' : 'session_revocation_failed',
      message: error instanceof Error ? error.message : 'Unable to complete the security action.'
    });
  }
}
