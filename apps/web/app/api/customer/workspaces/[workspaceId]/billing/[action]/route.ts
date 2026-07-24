import { NextRequest, NextResponse } from 'next/server';

import { API_URL, customerHeaders, requireCustomerWorkspace } from '../../../../session';

const ACTIONS: Record<string, { target: string; method: 'POST' | 'PATCH' }> = {
  'start-trial': { target: 'start-trial', method: 'POST' },
  subscription: { target: 'subscription', method: 'PATCH' },
  cancel: { target: 'cancel', method: 'POST' },
  reactivate: { target: 'reactivate', method: 'POST' }
};
const ADMIN_ROLES = new Set(['owner', 'admin']);

async function forward(request: NextRequest, context: { params: Promise<{ workspaceId: string; action: string }> }) {
  const { workspaceId, action } = await context.params;
  const operation = ACTIONS[action];
  if (!operation) return NextResponse.json({ error: 'billing_action_not_found', message: 'Unknown billing action.' }, { status: 404 });
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;
  if (!ADMIN_ROLES.has(access.workspace.role)) {
    return NextResponse.json({ error: 'workspace_role_required', message: 'Admin or owner access is required.' }, { status: 403 });
  }
  try {
    const hasBody = action === 'subscription';
    const response = await fetch(`${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/billing/${operation.target}`, {
      method: operation.method,
      headers: customerHeaders(request, hasBody ? { 'content-type': request.headers.get('content-type') || 'application/json' } : {}),
      body: hasBody ? await request.text() : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000)
    });
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: 'billing_action_unavailable', message: error instanceof Error ? error.message : 'Billing action is unavailable.' }, { status: 503 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceId: string; action: string }> }) {
  return forward(request, context);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ workspaceId: string; action: string }> }) {
  return forward(request, context);
}
