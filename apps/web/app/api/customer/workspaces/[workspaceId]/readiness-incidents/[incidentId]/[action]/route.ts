import { NextRequest, NextResponse } from 'next/server';

import { API_URL, internalAdminHeaders, requireCustomerWorkspace } from '../../../../../session';

const NO_STORE = { 'cache-control': 'no-store, max-age=0', pragma: 'no-cache' };
const ALLOWED_ACTIONS = new Set(['acknowledge', 'resolve']);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; incidentId: string; action: string }> }
) {
  const { workspaceId, incidentId, action } = await params;
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;
  if (!['owner', 'admin'].includes(String(access.workspace.role))) {
    return NextResponse.json(
      { error: 'workspace_role_required', message: 'Owner or admin access is required to update readiness incidents.' },
      { status: 403, headers: NO_STORE }
    );
  }
  if (!ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json(
      { error: 'invalid_incident_action', message: 'Unsupported readiness incident action.' },
      { status: 404, headers: NO_STORE }
    );
  }

  const body = await request.json().catch(() => ({}));
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';

  try {
    const response = await fetch(
      `${API_URL}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/readiness-incidents/${encodeURIComponent(incidentId)}/${action}`,
      {
        method: 'POST',
        headers: internalAdminHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ note }),
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000)
      }
    );
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status, headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'readiness_incident_update_unavailable',
        message: error instanceof Error ? error.message : 'Readiness incident update is unavailable.'
      },
      { status: 503, headers: NO_STORE }
    );
  }
}
