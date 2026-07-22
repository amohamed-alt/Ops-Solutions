import { NextRequest, NextResponse } from 'next/server';

import { API_URL, customerHeaders, requireCustomerWorkspace } from '../../../session';

export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;
  const before = request.nextUrl.searchParams.get('before');
  const url = new URL(`${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/audit`);
  url.searchParams.set('limit', '50');
  if (before) url.searchParams.set('before', before);
  const response = await fetch(url, { headers: customerHeaders(request), cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}
