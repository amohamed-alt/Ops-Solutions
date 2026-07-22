import { NextResponse } from 'next/server';

import { API_URL, internalAdminHeaders, requireCustomerWorkspace } from '../../../customer/session';

export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const customerAccess = await requireCustomerWorkspace(request, workspaceId);
  if (!customerAccess.ok) return customerAccess.response;

  try {
    const incoming = new URL(request.url);
    const target = new URL(`${API_URL}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/analytics/revenue/export.csv`);
    for (const [key, value] of incoming.searchParams.entries()) target.searchParams.set(key, value);

    const response = await fetch(target, {
      headers: internalAdminHeaders(),
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
        'x-content-type-options': 'nosniff'
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The revenue export is unavailable.';
    return NextResponse.json({ error: 'export_unavailable', message }, { status: 503 });
  }
}
