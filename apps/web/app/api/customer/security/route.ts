import { NextRequest, NextResponse } from 'next/server';

import { API_URL, customerHeaders, getCustomerContext } from '../session';

async function readJson(response: Response) {
  return response.json().catch(() => ({}));
}

export async function GET(request: NextRequest) {
  const context = await getCustomerContext(request);
  if (!context) return NextResponse.json({ error: 'session_required', message: 'Sign in to continue.' }, { status: 401 });

  try {
    const response = await fetch(`${API_URL}/api/v1/customer/security`, {
      headers: customerHeaders(request),
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000)
    });
    return NextResponse.json(await readJson(response), {
      status: response.status,
      headers: { 'cache-control': 'no-store, max-age=0' }
    });
  } catch (error) {
    return NextResponse.json({
      error: 'account_security_unavailable',
      message: error instanceof Error ? error.message : 'Unable to load account security.'
    }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const context = await getCustomerContext(request);
  if (!context) return NextResponse.json({ error: 'session_required', message: 'Sign in to continue.' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (String(body.action ?? '').trim() !== 'trust_current_device') {
    return NextResponse.json({ error: 'invalid_security_action', message: 'Choose a supported device action.' }, { status: 400 });
  }

  try {
    const response = await fetch(`${API_URL}/api/v1/customer/security/devices/trust-current`, {
      method: 'POST',
      headers: customerHeaders(request),
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000)
    });
    return NextResponse.json(await readJson(response), {
      status: response.status,
      headers: { 'cache-control': 'no-store, max-age=0' }
    });
  } catch (error) {
    return NextResponse.json({
      error: 'device_trust_failed',
      message: error instanceof Error ? error.message : 'Unable to trust the current device.'
    }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest) {
  const context = await getCustomerContext(request);
  if (!context) return NextResponse.json({ error: 'session_required', message: 'Sign in to continue.' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? '').trim();
  const sessionId = String(body.sessionId ?? '').trim();
  let path = '/api/v1/customer/security/sessions';

  if (action === 'revoke_session') {
    if (!/^[0-9a-f]{64}$/i.test(sessionId)) {
      return NextResponse.json({ error: 'invalid_session_id', message: 'Session ID is invalid.' }, { status: 400 });
    }
    path += `/${encodeURIComponent(sessionId)}`;
  } else if (action === 'revoke_stale') {
    path += '/stale?days=30';
  } else if (action !== 'revoke_others') {
    return NextResponse.json({ error: 'invalid_security_action', message: 'Choose a supported session action.' }, { status: 400 });
  }

  try {
    const response = await fetch(`${API_URL}${path}`, {
      method: 'DELETE',
      headers: customerHeaders(request),
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000)
    });
    if (response.status === 204) return new NextResponse(null, { status: 204 });
    return NextResponse.json(await readJson(response), {
      status: response.status,
      headers: { 'cache-control': 'no-store, max-age=0' }
    });
  } catch (error) {
    return NextResponse.json({
      error: 'session_revocation_failed',
      message: error instanceof Error ? error.message : 'Unable to revoke the selected session.'
    }, { status: 503 });
  }
}
