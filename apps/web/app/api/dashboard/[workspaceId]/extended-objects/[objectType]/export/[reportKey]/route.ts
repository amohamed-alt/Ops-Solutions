import { NextRequest, NextResponse } from 'next/server';

import { requireOperationsAccess, adminHeaders } from '../../../../../../operations/auth';
import { API_URL, internalAdminHeaders, requireCustomerWorkspace } from '../../../../../../customer/session';

const EXPORT_TIMEOUT_MS = 180_000;

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
      `${API_URL}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/analytics/extended-objects/${encodeURIComponent(objectType)}/export/${encodeURIComponent(reportKey)}.csv`
    );
    for (const [key, value] of incoming.searchParams.entries()) target.searchParams.set(key, value);
    const response = await fetch(target, {
      headers: operationsAccess.ok ? adminHeaders() : internalAdminHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS)
    });
    const body = await response.arrayBuffer();
    return new NextResponse(body, {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') || 'text/csv; charset=utf-8',
        'content-disposition': response.headers.get('content-disposition') || 'attachment; filename="crm-export.csv"',
        'cache-control': 'private, no-store',
        'x-export-row-count': response.headers.get('x-export-row-count') || '0',
        'x-export-truncated': response.headers.get('x-export-truncated') || 'false'
      }
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return NextResponse.json({
      error: timedOut ? 'extended_object_export_timeout' : 'extended_object_export_unavailable',
      message: timedOut
        ? 'The export exceeded the safe processing window. Narrow the filters and retry.'
        : error instanceof Error ? error.message : 'CRM export is unavailable.'
    }, { status: timedOut ? 504 : 503 });
  }
}
