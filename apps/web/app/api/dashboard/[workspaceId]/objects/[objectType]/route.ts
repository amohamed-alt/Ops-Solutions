import { NextRequest, NextResponse } from 'next/server';

import { requireOperationsAccess, adminHeaders } from '../../../../operations/auth';
import { API_URL, internalAdminHeaders, requireCustomerWorkspace } from '../../../../customer/session';

const OBJECT_DETAIL_TIMEOUT_MS = 90_000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; objectType: string }> }
) {
  const { workspaceId, objectType } = await params;
  const operationsAccess = requireOperationsAccess(request);
  if (!operationsAccess.ok) {
    const customerAccess = await requireCustomerWorkspace(request, workspaceId);
    if (!customerAccess.ok) return customerAccess.response;
  }

  try {
    const incoming = new URL(request.url);
    const target = new URL(
      `${API_URL}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/analytics/objects/${encodeURIComponent(objectType)}`
    );
    for (const [key, value] of incoming.searchParams.entries()) target.searchParams.set(key, value);
    const response = await fetch(target, {
      headers: operationsAccess.ok ? adminHeaders() : internalAdminHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(OBJECT_DETAIL_TIMEOUT_MS)
    });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return NextResponse.json({
      error: timedOut ? 'object_detail_timeout' : 'object_detail_unavailable',
      message: timedOut
        ? 'This object report is large. Retry with a shorter date range.'
        : error instanceof Error ? error.message : 'Object report details are unavailable.'
    }, { status: timedOut ? 504 : 503 });
  }
}
