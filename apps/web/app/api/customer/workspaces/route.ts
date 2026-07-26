import { NextRequest, NextResponse } from 'next/server';

import { API_URL, customerHeaders, internalAdminHeaders, getCustomerContext } from '../session';

const EMPTY_SYNC_STATE = Object.freeze({
  initialized: false,
  activeRun: null,
  latestRun: null,
  cursors: [],
  recordCounts: [],
  freshness: null
});

async function readInternalJson(url: string) {
  try {
    const response = await fetch(url, {
      headers: internalAdminHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000)
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const context = await getCustomerContext(request);
  if (!context) return NextResponse.json({ error: 'session_required', message: 'Sign in to continue.' }, { status: 401 });

  try {
    const results = await Promise.all((context.workspaces ?? []).map(async (membership: { id: string; name: string; slug: string; status: string; role: string; portalId: number | null; hubspotStatus: string | null; lastDiscoveredAt: string | null }) => {
      const [setup, syncResult] = await Promise.all([
        readInternalJson(`${API_URL}/api/v1/workspaces/${membership.id}/setup`),
        readInternalJson(`${API_URL}/api/v1/workspaces/${membership.id}/sync`)
      ]);
      const sync = syncResult ?? EMPTY_SYNC_STATE;
      return {
        ...sync,
        workspace: {
          id: membership.id,
          name: membership.name,
          slug: membership.slug,
          status: membership.status,
          role: membership.role,
          portal_id: setup?.hubspot?.portalId ?? membership.portalId,
          hubspot_status: setup?.hubspot?.status ?? membership.hubspotStatus,
          last_discovered_at: setup?.hubspot?.lastDiscoveredAt ?? membership.lastDiscoveredAt
        },
        setup,
        degraded: setup === null || syncResult === null
      };
    }));
    return NextResponse.json({ user: context.user, results });
  } catch (error) {
    return NextResponse.json({ error: 'workspace_status_unavailable', message: error instanceof Error ? error.message : 'Unable to load workspace.' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const context = await getCustomerContext(request);
  const anchorWorkspace = context?.workspaces?.[0];
  if (!context || !anchorWorkspace) {
    return NextResponse.json({ error: 'session_required', message: 'Sign in to continue.' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const response = await fetch(`${API_URL}/api/v1/customer/workspaces/${anchorWorkspace.id}/companies`, {
      method: 'POST',
      headers: customerHeaders(request, { 'content-type': 'application/json' }),
      body: JSON.stringify({ name: body?.name ?? body?.companyName }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000)
    });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json({
      error: 'workspace_creation_unavailable',
      message: error instanceof Error ? error.message : 'Unable to create company workspace.'
    }, { status: 503 });
  }
}
