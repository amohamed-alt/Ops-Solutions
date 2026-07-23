import { NextRequest, NextResponse } from 'next/server';

import { API_URL, customerHeaders, requireCustomerWorkspace } from '../../../session';

export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;
  try {
    const incoming = new URL(request.url);
    const target = new URL(`${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/intelligence`);
    for (const [key, value] of incoming.searchParams.entries()) target.searchParams.set(key, value);
    const response = await fetch(target, {
      headers: customerHeaders(request),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000)
    });
    const payload = await response.json().catch(() => ({ error: 'invalid_api_response', message: 'The intelligence service returned an invalid response.' }));
    return NextResponse.json(payload, { status: response.status, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({
      error: 'intelligence_service_unavailable',
      message: error instanceof Error ? error.message : 'Unable to reach the revenue intelligence service.'
    }, { status: 503 });
  }
}
