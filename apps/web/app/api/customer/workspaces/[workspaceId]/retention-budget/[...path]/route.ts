import { NextRequest, NextResponse } from 'next/server';

import { API_URL, customerHeaders, requireCustomerWorkspace } from '../../../../session';

const ADMIN_ROLES = new Set(['owner', 'admin']);
const SAFE_PATH = /^[a-z0-9-]+$/i;

async function forward(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string; path: string[] }> },
  method: 'GET' | 'POST' | 'DELETE'
) {
  const { workspaceId, path } = await context.params;
  if (!Array.isArray(path) || path.length === 0 || path.length > 4 || path.some((part) => !SAFE_PATH.test(part))) {
    return NextResponse.json({ error: 'retention_path_invalid', message: 'Retention budget path is invalid.' }, { status: 400 });
  }
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;
  if (method !== 'GET' && !ADMIN_ROLES.has(access.workspace.role)) {
    return NextResponse.json({ error: 'workspace_role_required', message: 'Admin or owner access is required.' }, { status: 403 });
  }
  try {
    const incoming = new URL(request.url);
    const target = new URL(`${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/retention-budget/${path.map(encodeURIComponent).join('/')}`);
    for (const [key, value] of incoming.searchParams.entries()) target.searchParams.set(key, value);
    const response = await fetch(target, {
      method,
      headers: customerHeaders(request),
      body: method === 'GET' ? undefined : await request.text(),
      cache: 'no-store',
      signal: AbortSignal.timeout(method === 'GET' ? 60_000 : 180_000)
    });
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/csv')) {
      return new NextResponse(await response.arrayBuffer(), {
        status: response.status,
        headers: {
          'content-type': contentType,
          'content-disposition': response.headers.get('content-disposition') || 'attachment; filename="retention-budget.csv"',
          'cache-control': 'private, no-store'
        }
      });
    }
    if (response.status === 204) return new NextResponse(null, { status: 204 });
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: 'retention_budget_unavailable', message: error instanceof Error ? error.message : 'Retention budget service is unavailable.' }, { status: 503 });
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ workspaceId: string; path: string[] }> }) {
  return forward(request, context, 'GET');
}
export async function POST(request: NextRequest, context: { params: Promise<{ workspaceId: string; path: string[] }> }) {
  return forward(request, context, 'POST');
}
export async function DELETE(request: NextRequest, context: { params: Promise<{ workspaceId: string; path: string[] }> }) {
  return forward(request, context, 'DELETE');
}
