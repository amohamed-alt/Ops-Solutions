import { NextResponse } from 'next/server';

import { requireOperationsAccess, adminHeaders } from '../../../../operations/auth';
import { API_URL, internalAdminHeaders, requireCustomerWorkspace } from '../../../../customer/session';

export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string; reportKey: string }> }) {
  const { workspaceId, reportKey } = await params;
  const operationsAccess = requireOperationsAccess(request);
  if (!operationsAccess.ok) {
    const customerAccess = await requireCustomerWorkspace(request, workspaceId);
    if (!customerAccess.ok) return customerAccess.response;
  }

  try {
    const incoming = new URL(request.url);
    const target = new URL(`${API_URL}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/analytics/revenue/drilldowns/${encodeURIComponent(reportKey)}`);
    for (const [key, value] of incoming.searchParams.entries()) target.searchParams.set(key, value);
    const response = await fetch(target, {
      headers: operationsAccess.ok ? adminHeaders() : internalAdminHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000)
    });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Report details are unavailable.';
    return NextResponse.json({ error: 'revenue_drilldown_unavailable', message }, { status: 503 });
  }
}
