import { NextRequest, NextResponse } from 'next/server';

import { API_URL, customerHeaders } from '../../../session';

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const response = await fetch(`${API_URL}/api/v1/auth/invitations/${encodeURIComponent(token)}/accept`, {
    method: 'POST', headers: customerHeaders(request), cache: 'no-store'
  });
  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}
