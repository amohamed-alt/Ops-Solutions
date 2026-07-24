import { NextRequest, NextResponse } from 'next/server';

import { API_URL, customerHeaders, requireCustomerWorkspace } from '../../../../session';

const ADMIN_ROLES = new Set(['owner', 'admin']);
const SAFE_PATH = /^[a-z0-9-]+$/i;

async function forward(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string; path?: string[] }> },
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
) {
  const { workspaceId, path = [] } = await context.params;
  if (path.length > 3 || path.some((part) => !SAFE_PATH.test(part))) {
    return NextResponse.json({ error: 'alert_path_invalid', message: 'Operational alert path is invalid.' }, { status: 400 });
  }
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;
  if (method !== 'GET' && !ADMIN_ROLES.has(access.workspace.role)) {
    return NextResponse.json({ error: 'workspace_role_required', message: 'Admin or owner access is required.' }, { status: 403 });
  }
  try {
    const suffix = path.length ? `/${path.map(encodeURIComponent).join('/')}` : '';
    const target = `${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/alerts${suffix}`;
    const response = await fetch(target, {
      method,
      headers: customerHeaders(request),
      body: ['POST', 'PATCH'].includes(method) ? await request.text() : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(path.at(-1) === 'test' ? 180_000 : 60_000)
    });
    if (response.status === 204) return new NextResponse(null, { status: 204 });
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({
      error: 'operational_alerts_unavailable',
      message: error instanceof Error ? error.message : 'Operational alerts are unavailable.'
    }, { status: 503 });
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ workspaceId: string; path?: string[] }> }) {
  return forward(request, context, 'GET');
}
export async function POST(request: NextRequest, context: { params: Promise<{ workspaceId: string; path?: string[] }> }) {
  return forward(request, context, 'POST');
}
export async function PATCH(request: NextRequest, context: { params: Promise<{ workspaceId: string; path?: string[] }> }) {
  return forward(request, context, 'PATCH');
}
export async function DELETE(request: NextRequest, context: { params: Promise<{ workspaceId: string; path?: string[] }> }) {
  return forward(request, context, 'DELETE');
}
