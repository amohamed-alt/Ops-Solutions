import { NextRequest, NextResponse } from 'next/server';

import { API_URL, customerHeaders, requireCustomerWorkspace } from '../../../../../session';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; scheduleId: string }> }
) {
  const { workspaceId, scheduleId } = await params;
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;

  try {
    const response = await fetch(
      `${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/report-schedules/${encodeURIComponent(scheduleId)}/executions`,
      {
        method: 'GET',
        headers: customerHeaders(request),
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000)
      }
    );
    const body = await response.json().catch(() => ({}));
    return NextResponse.json(body, {
      status: response.status,
      headers: { 'cache-control': 'no-store' }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'report_schedule_executions_unavailable',
        message: error instanceof Error ? error.message : 'Unable to load scheduled report executions.'
      },
      { status: 503 }
    );
  }
}
