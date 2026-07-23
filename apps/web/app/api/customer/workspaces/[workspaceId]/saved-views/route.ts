import { NextRequest, NextResponse } from 'next/server';

import { API_URL, customerHeaders, requireCustomerWorkspace } from '../../../session';

async function forward(request: NextRequest, workspaceId: string, method: 'GET' | 'POST') {
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;
  try {
    const response = await fetch(`${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/saved-views`, {
      method,
      headers: customerHeaders(request, method === 'POST' ? { 'content-type': 'application/json' } : {}),
      body: method === 'POST' ? JSON.stringify(await request.json().catch(() => ({}))) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000)
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
    return payload === null ? new NextResponse(null, { status: response.status }) : NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: 'saved_views_unavailable', message: error instanceof Error ? error.message : 'Saved views are unavailable.' }, { status: 503 });
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  return forward(request, (await params).workspaceId, 'GET');
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  return forward(request, (await params).workspaceId, 'POST');
}
