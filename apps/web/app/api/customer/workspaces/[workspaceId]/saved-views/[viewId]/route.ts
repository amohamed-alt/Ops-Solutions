import { NextRequest, NextResponse } from 'next/server';

import { API_URL, customerHeaders, requireCustomerWorkspace } from '../../../../../session';

async function forward(request: NextRequest, workspaceId: string, viewId: string, method: 'PATCH' | 'DELETE') {
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;
  try {
    const response = await fetch(`${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/saved-views/${encodeURIComponent(viewId)}`, {
      method,
      headers: customerHeaders(request),
      body: method === 'PATCH' ? JSON.stringify(await request.json()) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000)
    });
    if (response.status === 204) return new NextResponse(null, { status: 204 });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: 'saved_view_unavailable', message: error instanceof Error ? error.message : 'Saved view is unavailable.' }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ workspaceId: string; viewId: string }> }) {
  const { workspaceId, viewId } = await params;
  return forward(request, workspaceId, viewId, 'PATCH');
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ workspaceId: string; viewId: string }> }) {
  const { workspaceId, viewId } = await params;
  return forward(request, workspaceId, viewId, 'DELETE');
}
