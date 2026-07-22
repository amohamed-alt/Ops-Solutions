import { NextRequest, NextResponse } from 'next/server';

import { API_URL, customerHeaders, requireCustomerWorkspace } from '../../../customer/session';

const ALLOWED_FILTERS = new Set([
  'from', 'to', 'ownerId', 'country', 'leadSource', 'pipelineId', 'stageId', 'viewName'
]);

export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const customerAccess = await requireCustomerWorkspace(request, workspaceId);
  if (!customerAccess.ok) return customerAccess.response;

  try {
    const incoming = new URL(request.url);
    const target = new URL(`${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/exports/revenue.csv`);
    for (const [key, value] of incoming.searchParams.entries()) {
      if (ALLOWED_FILTERS.has(key)) target.searchParams.set(key, value);
    }

    const response = await fetch(target, {
      headers: customerHeaders(request),
      cache: 'no-store',
      signal: AbortSignal.timeout(60_000)
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({
        error: 'export_failed',
        message: 'The revenue export could not be generated.'
      }));
      return NextResponse.json(payload, { status: response.status });
    }

    const csv = await response.arrayBuffer();
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'content-type': response.headers.get('content-type') || 'text/csv; charset=utf-8',
        'content-disposition': response.headers.get('content-disposition') || 'attachment; filename="revenue-report.csv"',
        'cache-control': 'private, no-store, max-age=0',
        'x-content-type-options': 'nosniff',
        'x-rate-limit-limit': response.headers.get('x-rate-limit-limit') || '5',
        'x-rate-limit-remaining': response.headers.get('x-rate-limit-remaining') || '0'
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The revenue export is unavailable.';
    return NextResponse.json({ error: 'export_unavailable', message }, { status: 503 });
  }
}
