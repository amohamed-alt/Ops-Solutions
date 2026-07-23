import { NextRequest, NextResponse } from 'next/server';

import { API_URL, customerHeaders, requireCustomerWorkspace } from '../../../session';

const ADMIN_ROLES = new Set(['owner', 'admin']);

async function forward(request: NextRequest, workspaceId: string, method: string) {
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;
  if (method !== 'GET' && !ADMIN_ROLES.has(access.workspace.role)) {
    return NextResponse.json({ error: 'workspace_role_required', message: 'Admin access is required to manage report schedules.' }, { status: 403 });
  }
  try {
    const response = await fetch(`${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/report-schedules`, {
      method,
      headers: customerHeaders(request),
      body: method === 'GET' ? undefined : await request.text(),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000)
    });
    const body = response.status === 204 ? null : await response.json().catch(() => ({}));
    return body === null
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json(body, { status: response.status, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: 'report_schedules_unavailable', message: error instanceof Error ? error.message : 'Unable to manage report schedules.' }, { status: 503 });
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  return forward(request, (await params).workspaceId, 'GET');
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  return forward(request, (await params).workspaceId, 'POST');
}
