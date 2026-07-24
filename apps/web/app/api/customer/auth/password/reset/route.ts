import { NextRequest, NextResponse } from 'next/server';

import { API_URL, clearCustomerSession } from '../../../session';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const response = await fetch(`${API_URL}/api/v1/auth/password/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000)
    });
    const payload = await response.json().catch(() => ({}));
    const result = NextResponse.json(payload, {
      status: response.status,
      headers: { 'cache-control': 'no-store, max-age=0' }
    });
    return response.ok ? clearCustomerSession(result) : result;
  } catch (error) {
    return NextResponse.json(
      { error: 'password_reset_unavailable', message: error instanceof Error ? error.message : 'Unable to reset your password.' },
      { status: 503 }
    );
  }
}
