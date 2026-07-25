import { NextRequest, NextResponse } from 'next/server';

import { API_URL, internalAdminHeaders, requireCustomerWorkspace } from '../../../../session';

const NO_STORE = { 'cache-control': 'no-store, max-age=0', pragma: 'no-cache' };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; incidentId: string }> }
) {
  const { workspaceId, incidentId } = await params;
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;

  try {
    const response = await fetch(
      `${API_URL}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/readiness-incidents/${encodeURIComponent(incidentId)}`,
      {
        headers: internalAdminHeaders(),
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000)
      }
    );
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status, headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'readiness_incident_unavailable',
        message: error instanceof Error ? error.message : 'The readiness incident is unavailable.'
      },
      { status: 503, headers: NO_STORE }
    );
  }
}
