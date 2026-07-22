import { NextResponse } from 'next/server';

import { adminHeaders, requireOperationsAccess } from '../../../operations/auth';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://api:3001';

export async function GET(request, { params }) {
  const access = requireOperationsAccess(request);
  if (!access.ok) {
    return NextResponse.json({ error: 'dashboard_access_denied', message: access.message }, { status: access.status });
  }

  const { workspaceId } = await params;
  const { searchParams } = new URL(request.url);
  const limit = searchParams.get('limit') ?? '50';
  const offset = searchParams.get('offset') ?? '0';

  try {
    const response = await fetch(
      `${API_URL}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/analytics/sdr/drilldowns/priority-leads-needing-action?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`,
      { headers: adminHeaders(), cache: 'no-store', signal: AbortSignal.timeout(20_000) }
    );
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: 'drilldown_unavailable', message: error.message }, { status: 503 });
  }
}
