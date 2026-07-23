import { NextRequest, NextResponse } from 'next/server';

import { requireOperationsAccess, adminHeaders } from '../../../operations/auth';
import { API_URL, internalAdminHeaders, requireCustomerWorkspace } from '../../../customer/session';

function reportTimeoutMs(scope: string | null) {
  if (scope === 'core') return 60_000;
  if (scope === 'operating') return 180_000;
  return 90_000;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const operationsAccess = requireOperationsAccess(request);
  if (!operationsAccess.ok) {
    const customerAccess = await requireCustomerWorkspace(request, workspaceId);
    if (!customerAccess.ok) return customerAccess.response;
  }

  try {
    const incoming = new URL(request.url);
    const target = new URL(`${API_URL}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/analytics/revenue`);
    for (const [key, value] of incoming.searchParams.entries()) target.searchParams.set(key, value);
    const response = await fetch(target, {
      headers: operationsAccess.ok ? adminHeaders() : internalAdminHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(reportTimeoutMs(incoming.searchParams.get('scope')))
    });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    const message = timedOut
      ? 'This report took too long to compile. The dashboard can retry without rebuilding or resynchronizing HubSpot.'
      : error instanceof Error ? error.message : 'Revenue reporting is unavailable.';
    return NextResponse.json(
      { error: timedOut ? 'revenue_reporting_timeout' : 'revenue_reporting_unavailable', message },
      { status: timedOut ? 504 : 503 }
    );
  }
}
