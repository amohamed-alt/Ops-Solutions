import { NextRequest, NextResponse } from 'next/server';

import { API_URL, customerHeaders, requireCustomerWorkspace } from '../../../session';

async function forward(request: NextRequest, workspaceId: string, init: RequestInit = {}) {
  try {
    const response = await fetch(`${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/preferences`, {
      ...init,
      headers: { ...customerHeaders(request), ...(init.body ? { 'content-type': 'application/json' } : {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000)
    });
    const payload = await response.json().catch(() => ({ error: 'invalid_api_response', message: 'The preferences service returned an invalid response.' }));
    return NextResponse.json(payload, { status: response.status, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({
      error: 'preferences_service_unavailable',
      message: error instanceof Error ? error.message : 'Unable to reach the preferences service.'
    }, { status: 503 });
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;
  return forward(request, workspaceId);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;
  const body = await request.json().catch(() => ({}));
  return forward(request, workspaceId, { method: 'PUT', body: JSON.stringify(body) });
}
