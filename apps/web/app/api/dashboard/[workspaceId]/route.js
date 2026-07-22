import { NextResponse } from 'next/server';

import { requireOperationsAccess, adminHeaders } from '../../operations/auth';
import { API_URL, internalAdminHeaders, requireCustomerWorkspace } from '../../customer/session';

export async function GET(request, { params }) {
  const { workspaceId } = await params;
  const operationsAccess = requireOperationsAccess(request);
  if (!operationsAccess.ok) {
    const customerAccess = await requireCustomerWorkspace(request, workspaceId);
    if (!customerAccess.ok) return customerAccess.response;
  }

  try {
    const response = await fetch(`${API_URL}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/analytics/sdr`, {
      headers: operationsAccess.ok ? adminHeaders() : internalAdminHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000)
    });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: 'dashboard_unavailable', message: error.message }, { status: 503 });
  }
}
