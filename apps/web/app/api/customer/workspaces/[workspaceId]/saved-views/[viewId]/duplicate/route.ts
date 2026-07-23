import { NextRequest, NextResponse } from 'next/server';

import { API_URL, customerHeaders, requireCustomerWorkspace } from '../../../../../session';

export async function POST(request: NextRequest, { params }: { params: Promise<{ workspaceId: string; viewId: string }> }) {
  const { workspaceId, viewId } = await params;
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;
  try {
    const response = await fetch(`${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/saved-views/${encodeURIComponent(viewId)}/duplicate`, {
      method: 'POST',
      headers: customerHeaders(request, { 'content-type': 'application/json' }),
      body: JSON.stringify(await request.json().catch(() => ({}))),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000)
    });
    return NextResponse.json(await response.json().catch(() => ({})), { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: 'saved_view_duplicate_unavailable', message: error instanceof Error ? error.message : 'Saved view duplication is unavailable.' }, { status: 503 });
  }
}
