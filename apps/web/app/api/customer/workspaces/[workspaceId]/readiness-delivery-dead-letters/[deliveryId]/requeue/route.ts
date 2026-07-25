import { NextRequest, NextResponse } from 'next/server';

import { API_URL, internalAdminHeaders, requireCustomerWorkspace } from '../../../../../session';

const NO_STORE = { 'cache-control': 'no-store, max-age=0', pragma: 'no-cache' };

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; deliveryId: string }> }
) {
  const { workspaceId, deliveryId } = await params;
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;
  if (!['owner', 'admin'].includes(String(access.workspace.role))) {
    return NextResponse.json(
      { error: 'workspace_role_required', message: 'Owner or admin access is required to retry readiness notifications.' },
      { status: 403, headers: NO_STORE }
    );
  }

  const body = await request.json().catch(() => ({}));
  const apply = body.apply === true;

  try {
    const response = await fetch(
      `${API_URL}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/readiness-delivery-dead-letters/${encodeURIComponent(deliveryId)}/requeue`,
      {
        method: 'POST',
        headers: internalAdminHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ apply }),
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000)
      }
    );
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status, headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'readiness_dead_letter_requeue_unavailable',
        message: error instanceof Error ? error.message : 'Readiness delivery retry is unavailable.'
      },
      { status: 503, headers: NO_STORE }
    );
  }
}
