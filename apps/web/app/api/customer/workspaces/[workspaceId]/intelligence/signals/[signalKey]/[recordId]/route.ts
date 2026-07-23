import { NextRequest, NextResponse } from 'next/server';

import { API_URL, customerHeaders, requireCustomerWorkspace } from '../../../../../../session';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; signalKey: string; recordId: string }> }
) {
  const { workspaceId, signalKey, recordId } = await params;
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;
  try {
    const body = await request.json().catch(() => ({}));
    const response = await fetch(
      `${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/intelligence/signals/${encodeURIComponent(signalKey)}/${encodeURIComponent(recordId)}`,
      {
        method: 'PATCH',
        headers: { ...customerHeaders(request), 'content-type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000)
      }
    );
    const payload = await response.json().catch(() => ({ error: 'invalid_api_response', message: 'The signal service returned an invalid response.' }));
    return NextResponse.json(payload, { status: response.status, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({
      error: 'signal_service_unavailable',
      message: error instanceof Error ? error.message : 'Unable to update the revenue signal.'
    }, { status: 503 });
  }
}
