import { NextRequest, NextResponse } from 'next/server';

import { API_URL, internalAdminHeaders, getCustomerContext } from '../session';

export async function GET(request: NextRequest) {
  const context = await getCustomerContext(request);
  if (!context) return NextResponse.json({ error: 'session_required', message: 'Sign in to continue.' }, { status: 401 });

  try {
    const results = await Promise.all((context.workspaces ?? []).map(async (membership: { id: string; name: string; slug: string; status: string; role: string; portalId: number | null; hubspotStatus: string | null; lastDiscoveredAt: string | null }) => {
      const [setupResponse, syncResponse] = await Promise.all([
        fetch(`${API_URL}/api/v1/workspaces/${membership.id}/setup`, {
          headers: internalAdminHeaders(), cache: 'no-store', signal: AbortSignal.timeout(15_000)
        }),
        fetch(`${API_URL}/api/v1/workspaces/${membership.id}/sync`, {
          headers: internalAdminHeaders(), cache: 'no-store', signal: AbortSignal.timeout(15_000)
        })
      ]);
      const setup = setupResponse.ok ? await setupResponse.json() : null;
      const sync = syncResponse.ok ? await syncResponse.json() : {
        initialized: false, activeRun: null, latestRun: null, cursors: [], recordCounts: [], freshness: null
      };
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
        setup
      };
    }));
    return NextResponse.json({ user: context.user, results });
  } catch (error) {
    return NextResponse.json({ error: 'workspace_status_unavailable', message: error instanceof Error ? error.message : 'Unable to load workspace.' }, { status: 503 });
  }
}
