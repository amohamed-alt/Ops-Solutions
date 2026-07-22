import { NextResponse } from 'next/server';

import { adminHeaders, requireOperationsAccess } from '../auth';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://api:3001';

export async function GET(request) {
  const access = requireOperationsAccess(request);
  if (!access.ok) {
    return NextResponse.json({ error: 'operations_access_denied', message: access.message }, { status: access.status });
  }

  try {
    const response = await fetch(`${API_URL}/api/v1/workspaces`, {
      headers: adminHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000)
    });
    const payload = await response.json();
    if (!response.ok) return NextResponse.json(payload, { status: response.status });

    const connected = (payload.results ?? []).filter((workspace) => workspace.hubspot_status === 'connected');
    const workspaces = await Promise.all(connected.map(async (workspace) => {
      const syncResponse = await fetch(`${API_URL}/api/v1/workspaces/${workspace.id}/sync`, {
        headers: adminHeaders(),
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000)
      });
      if (!syncResponse.ok) {
        return {
          workspace,
          initialized: false,
          activeRun: null,
          latestRun: null,
          cursors: [],
          recordCounts: [],
          freshness: null,
          error: `Sync API returned ${syncResponse.status}`
        };
      }
      return syncResponse.json();
    }));

    return NextResponse.json({ results: workspaces });
  } catch (error) {
    return NextResponse.json({ error: 'operations_unavailable', message: error.message }, { status: 503 });
  }
}
