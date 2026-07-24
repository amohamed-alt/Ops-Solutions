import { NextRequest, NextResponse } from 'next/server';

import { API_URL, internalAdminHeaders, requireCustomerWorkspace } from '../../../session';

const NO_STORE = { 'cache-control': 'no-store, max-age=0', pragma: 'no-cache' };

async function forward(request: NextRequest, workspaceId: string, path = '', init: RequestInit = {}) {
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;

  try {
    const response = await fetch(
      `${API_URL}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/onboarding-readiness${path}`,
      {
        ...init,
        headers: internalAdminHeaders({
          ...(init.body ? { 'content-type': 'application/json' } : {})
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000)
      }
    );
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status, headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'onboarding_readiness_unavailable',
        message: error instanceof Error ? error.message : 'Onboarding readiness is unavailable.'
      },
      { status: 503, headers: NO_STORE }
    );
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const freshnessHours = request.nextUrl.searchParams.get('freshnessHours');
  const query = freshnessHours ? `?freshnessHours=${encodeURIComponent(freshnessHours)}` : '';
  return forward(request, workspaceId, query);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;
  if (!['owner', 'admin'].includes(String(access.workspace.role))) {
    return NextResponse.json(
      { error: 'workspace_role_required', message: 'Owner or admin access is required to record a readiness evaluation.' },
      { status: 403, headers: NO_STORE }
    );
  }

  const body = await request.json().catch(() => ({}));
  return forward(request, workspaceId, '/evaluate', {
    method: 'POST',
    body: JSON.stringify({ freshnessHours: body.freshnessHours })
  });
}
