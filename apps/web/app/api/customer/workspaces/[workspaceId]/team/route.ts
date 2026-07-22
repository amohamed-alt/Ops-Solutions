import { NextRequest, NextResponse } from 'next/server';

import { API_URL, customerHeaders, requireCustomerWorkspace } from '../../../session';

async function relay(response: Response) {
  if (response.status === 204) return new NextResponse(null, { status: 204 });
  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;
  const [members, invitations] = await Promise.all([
    fetch(`${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/members`, { headers: customerHeaders(request), cache: 'no-store' }),
    fetch(`${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/invitations`, { headers: customerHeaders(request), cache: 'no-store' })
  ]);
  const memberPayload = await members.json().catch(() => ({}));
  if (!members.ok) return NextResponse.json(memberPayload, { status: members.status });
  const invitationPayload = invitations.ok ? await invitations.json().catch(() => ({ results: [] })) : { results: [] };
  return NextResponse.json({ members: memberPayload.results ?? [], invitations: invitationPayload.results ?? [], role: access.workspace.role });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;
  const body = await request.json();
  const response = await fetch(`${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/invitations`, {
    method: 'POST', headers: customerHeaders(request), body: JSON.stringify(body), cache: 'no-store'
  });
  return relay(response);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;
  const body = await request.json();
  const response = await fetch(`${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(body.userId)}`, {
    method: 'PATCH', headers: customerHeaders(request), body: JSON.stringify({ role: body.role }), cache: 'no-store'
  });
  return relay(response);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;
  const body = await request.json();
  const kind = body.kind === 'invitation' ? 'invitations' : 'members';
  const id = body.kind === 'invitation' ? body.invitationId : body.userId;
  const response = await fetch(`${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/${kind}/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: customerHeaders(request), cache: 'no-store'
  });
  return relay(response);
}
