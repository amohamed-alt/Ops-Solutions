import { NextRequest, NextResponse } from 'next/server';

import { API_URL, internalAdminHeaders, requireCustomerWorkspace } from '../../../session';

const NO_STORE = { 'cache-control': 'no-store, max-age=0', pragma: 'no-cache' };
const STATUS_VALUES = new Set(['all', 'active', 'open', 'acknowledged', 'resolved']);
const SEVERITY_VALUES = new Set(['all', 'warning', 'critical']);
const SORT_VALUES = new Set(['activity_desc', 'activity_asc', 'blockers_desc', 'score_asc', 'occurrences_desc']);

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function enumValue(value: string | null, fallback: string, allowed: Set<string>) {
  return value && allowed.has(value) ? value : fallback;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;

  const query = new URLSearchParams();
  query.set('limit', String(boundedInteger(request.nextUrl.searchParams.get('limit'), 25, 1, 50)));
  query.set('minimumBlockers', String(boundedInteger(request.nextUrl.searchParams.get('minimumBlockers'), 0, 0, 999)));
  query.set('status', enumValue(request.nextUrl.searchParams.get('status'), 'all', STATUS_VALUES));
  query.set('severity', enumValue(request.nextUrl.searchParams.get('severity'), 'all', SEVERITY_VALUES));
  query.set('sort', enumValue(request.nextUrl.searchParams.get('sort'), 'activity_desc', SORT_VALUES));
  const cursor = request.nextUrl.searchParams.get('cursor');
  if (cursor) query.set('cursor', cursor.slice(0, 2048));

  try {
    const response = await fetch(
      `${API_URL}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/readiness-incidents?${query.toString()}`,
      {
        headers: internalAdminHeaders(),
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000)
      }
    );
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status, headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'readiness_incidents_unavailable',
        message: error instanceof Error ? error.message : 'Readiness incidents are unavailable.'
      },
      { status: 503, headers: NO_STORE }
    );
  }
}
