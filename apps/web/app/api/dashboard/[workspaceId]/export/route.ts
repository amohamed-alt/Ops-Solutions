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
    const format = incoming.searchParams.get('format') === 'pdf' ? 'pdf' : 'csv';
    const target = new URL(`${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/exports/revenue.${format}`);
    for (const [key, value] of incoming.searchParams.entries()) {
      if (ALLOWED_FILTERS.has(key)) target.searchParams.set(key, value);
    }

    const response = await fetch(target, {
      headers: customerHeaders(request),
      cache: 'no-store',
      signal: AbortSignal.timeout(format === 'pdf' ? 90_000 : 60_000)
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({
        error: 'export_failed',
        message: 'The revenue export could not be generated.'
      }));
      return NextResponse.json(payload, { status: response.status });
    }

    const artifact = await response.arrayBuffer();
    const defaultType = format === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8';
    const defaultFile = format === 'pdf' ? 'revenue-report.pdf' : 'revenue-report.csv';
    return new NextResponse(artifact, {
      status: 200,
      headers: {
        'content-type': response.headers.get('content-type') || defaultType,
        'content-disposition': response.headers.get('content-disposition') || `attachment; filename="${defaultFile}"`,
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
