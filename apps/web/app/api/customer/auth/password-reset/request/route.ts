import { NextRequest, NextResponse } from 'next/server';

import { API_URL } from '../../../session';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const response = await fetch(`${API_URL}/api/v1/auth/password-reset/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000)
    });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json({
      error: 'password_reset_request_unavailable',
      message: error instanceof Error ? error.message : 'Unable to request a password reset.'
    }, { status: 503 });
  }
}
