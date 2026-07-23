import { NextRequest, NextResponse } from 'next/server';

import { API_URL, customerHeaders, requireCustomerWorkspace } from '../../../../session';

const ADMIN_ROLES = new Set(['owner', 'admin']);

async function forward(request: NextRequest, workspaceId: string, scheduleId: string, method: 'PATCH' | 'DELETE') {
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;
  if (!ADMIN_ROLES.has(access.workspace.role)) {
    return NextResponse.json({ error: 'workspace_role_required', message: 'Admin access is required to manage report schedules.' }, { status: 403 });
  }
  try {
    const response = await fetch(`${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/report-schedules/${encodeURIComponent(scheduleId)}`, {
      method,
      headers: customerHeaders(request),
      body: method === 'PATCH' ? await request.text() : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000)
    });
    if (response.status === 204) return new NextResponse(null, { status: 204 });
    const body = await response.json().catch(() => ({}));
    return NextResponse.json(body, { status: response.status, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: 'report_schedule_operation_failed', message: error instanceof Error ? error.message : 'Report schedule operation failed.' }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ workspaceId: string; scheduleId: string }> }) {
  const { workspaceId, scheduleId } = await params;
  return forward(request, workspaceId, scheduleId, 'PATCH');
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ workspaceId: string; scheduleId: string }> }) {
  const { workspaceId, scheduleId } = await params;
  return forward(request, workspaceId, scheduleId, 'DELETE');
}
