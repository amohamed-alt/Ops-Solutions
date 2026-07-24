import { NextRequest, NextResponse } from 'next/server';

import { requireOperationsAccess, adminHeaders } from '../../../operations/auth';
import { API_URL, internalAdminHeaders, requireCustomerWorkspace } from '../../../customer/session';

const CATALOG_TIMEOUT_MS = 60_000;

export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const operationsAccess = requireOperationsAccess(request);
  if (!operationsAccess.ok) {
    const customerAccess = await requireCustomerWorkspace(request, workspaceId);
    if (!customerAccess.ok) return customerAccess.response;
  }

  try {
    const target = new URL(`${API_URL}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/analytics/extended-objects`);
    const response = await fetch(target, {
      headers: operationsAccess.ok ? adminHeaders() : internalAdminHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS)
    });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return NextResponse.json({
      error: timedOut ? 'extended_object_catalog_timeout' : 'extended_object_catalog_unavailable',
      message: timedOut
        ? 'The CRM object catalog took too long to compile. Retry without resynchronizing HubSpot.'
        : error instanceof Error ? error.message : 'The CRM object catalog is unavailable.'
    }, { status: timedOut ? 504 : 503 });
  }
}
