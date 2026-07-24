import { NextRequest, NextResponse } from 'next/server';

import { API_URL, customerHeaders, requireCustomerWorkspace } from '../../../session';

export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;
  try {
    const response = await fetch(`${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/billing`, {
      headers: customerHeaders(request),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000)
    });
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: 'billing_unavailable', message: error instanceof Error ? error.message : 'Billing status is unavailable.' }, { status: 503 });
  }
}
