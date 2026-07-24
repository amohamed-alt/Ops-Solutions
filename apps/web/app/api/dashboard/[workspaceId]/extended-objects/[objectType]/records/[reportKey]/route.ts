import { NextRequest, NextResponse } from 'next/server';

import { requireOperationsAccess, adminHeaders } from '../../../../../../operations/auth';
import { API_URL, internalAdminHeaders, requireCustomerWorkspace } from '../../../../../../customer/session';

const RECORDS_TIMEOUT_MS = 90_000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; objectType: string; reportKey: string }> }
) {
  const { workspaceId, objectType, reportKey } = await params;
  const operationsAccess = requireOperationsAccess(request);
  if (!operationsAccess.ok) {
    const customerAccess = await requireCustomerWorkspace(request, workspaceId);
    if (!customerAccess.ok) return customerAccess.response;
  }

  try {
    const incoming = new URL(request.url);
    const target = new URL(
      `${API_URL}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/analytics/extended-objects/${encodeURIComponent(objectType)}/records/${encodeURIComponent(reportKey)}`
    );
    for (const [key, value] of incoming.searchParams.entries()) target.searchParams.set(key, value);
    const response = await fetch(target, {
      headers: operationsAccess.ok ? adminHeaders() : internalAdminHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(RECORDS_TIMEOUT_MS)
    });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return NextResponse.json({
      error: timedOut ? 'extended_object_records_timeout' : 'extended_object_records_unavailable',
      message: timedOut
        ? 'This record search is large. Narrow the search or date range and retry.'
        : error instanceof Error ? error.message : 'CRM object records are unavailable.'
    }, { status: timedOut ? 504 : 503 });
  }
}
