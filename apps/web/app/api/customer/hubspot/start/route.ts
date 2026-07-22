import { NextRequest, NextResponse } from 'next/server';

import { API_URL, internalAdminHeaders, requireCustomerWorkspace } from '../../session';

export async function POST(request: NextRequest) {
  const requestedWorkspaceId = request.nextUrl.searchParams.get('workspaceId') ?? undefined;
  const access = await requireCustomerWorkspace(request, requestedWorkspaceId);
  if (!access.ok) return access.response;

  try {
    const returnTo = `/onboarding?workspaceId=${encodeURIComponent(access.workspace.id)}`;
    const response = await fetch(
      `${API_URL}/api/v1/workspaces/${access.workspace.id}/hubspot/oauth/start?returnTo=${encodeURIComponent(returnTo)}`,
      { headers: internalAdminHeaders(), cache: 'no-store', signal: AbortSignal.timeout(10_000) }
    );
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: 'hubspot_connect_unavailable', message: error instanceof Error ? error.message : 'Unable to start HubSpot connection.' }, { status: 503 });
  }
}
