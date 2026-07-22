import { NextResponse } from 'next/server';

import { requireOperationsAccess, adminHeaders } from '../../../operations/auth';
import { API_URL, internalAdminHeaders, requireCustomerWorkspace } from '../../../customer/session';

export async function GET(request, { params }) {
  const { workspaceId } = await params;
  const operationsAccess = requireOperationsAccess(request);
  if (!operationsAccess.ok) {
    const customerAccess = await requireCustomerWorkspace(request, workspaceId);
    if (!customerAccess.ok) return customerAccess.response;
  }

  const { searchParams } = new URL(request.url);
  const limit = searchParams.get('limit') ?? '50';
  const offset = searchParams.get('offset') ?? '0';

  try {
    const response = await fetch(
      `${API_URL}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/analytics/sdr/drilldowns/priority-leads-needing-action?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`,
      {
        headers: operationsAccess.ok ? adminHeaders() : internalAdminHeaders(),
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000)
      }
    );
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: 'drilldown_unavailable', message: error.message }, { status: 503 });
  }
}
