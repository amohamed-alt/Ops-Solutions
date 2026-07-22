import { NextRequest, NextResponse } from 'next/server';

import { API_URL, setCustomerSession } from '../../session';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const response = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000)
    });
    const payload = await response.json();
    if (!response.ok) return NextResponse.json(payload, { status: response.status });
    const result = NextResponse.json({ user: payload.user, workspaces: payload.workspaces });
    return setCustomerSession(result, payload.sessionToken);
  } catch (error) {
    return NextResponse.json({ error: 'login_unavailable', message: error instanceof Error ? error.message : 'Unable to sign in.' }, { status: 503 });
  }
}
