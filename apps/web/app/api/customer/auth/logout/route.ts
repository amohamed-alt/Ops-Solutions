import { NextRequest, NextResponse } from 'next/server';

import { API_URL, clearCustomerSession, customerHeaders } from '../../session';

export async function POST(request: NextRequest) {
  await fetch(`${API_URL}/api/v1/auth/logout`, {
    method: 'POST',
    headers: customerHeaders(request),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000)
  }).catch(() => undefined);
  return clearCustomerSession(NextResponse.json({ loggedOut: true }));
}
