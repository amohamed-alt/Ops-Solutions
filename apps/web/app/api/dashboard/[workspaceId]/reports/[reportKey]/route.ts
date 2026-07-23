import { NextRequest, NextResponse } from 'next/server';

import { requireOperationsAccess, adminHeaders } from '../../../../operations/auth';
import { API_URL, customerHeaders, internalAdminHeaders, requireCustomerWorkspace } from '../../../../customer/session';

export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string; reportKey: string }> }) {
  const { workspaceId, reportKey } = await params;
  const operationsAccess = requireOperationsAccess(request);
  let customerAccess: Awaited<ReturnType<typeof requireCustomerWorkspace>> | null = null;
  if (!operationsAccess.ok) {
    customerAccess = await requireCustomerWorkspace(request, workspaceId);
    if (!customerAccess.ok) return customerAccess.response;
  }

  try {
    const incoming = new URL(request.url);
    const target = new URL(`${API_URL}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/analytics/revenue/drilldowns/${encodeURIComponent(reportKey)}`);
    for (const [key, value] of incoming.searchParams.entries()) target.searchParams.set(key, value);

    if (customerAccess?.ok && customerAccess.workspace.role === 'viewer') {
      const scopeResponse = await fetch(
        `${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/intelligence/scope`,
        {
          headers: customerHeaders(request),
          cache: 'no-store',
          signal: AbortSignal.timeout(10_000)
        }
      );
      const scope = await scopeResponse.json().catch(() => ({}));
      if (!scopeResponse.ok) return NextResponse.json(scope, { status: scopeResponse.status });
      target.searchParams.set('ownerId', String(scope.ownerId || '__viewer_without_owner__'));
    }

    const response = await fetch(target, {
      headers: operationsAccess.ok ? adminHeaders() : internalAdminHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000)
    });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Report details are unavailable.';
    return NextResponse.json({ error: 'revenue_drilldown_unavailable', message }, { status: 503 });
  }
}
