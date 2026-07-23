import { NextRequest, NextResponse } from 'next/server';

import { API_URL, internalAdminHeaders, requireCustomerWorkspace } from '../../session';

const ACTIVE_SYNC_WINDOW_MS = 2 * 60 * 60 * 1000;

function timestamp(value: unknown) {
  if (!value) return null;
  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: NextRequest) {
  const requestedWorkspaceId = request.nextUrl.searchParams.get('workspaceId') ?? undefined;
  const access = await requireCustomerWorkspace(request, requestedWorkspaceId);
  if (!access.ok) return access.response;
  const workspaceId = access.workspace.id;

  try {
    const [setupResponse, syncResponse] = await Promise.all([
      fetch(`${API_URL}/api/v1/workspaces/${workspaceId}/setup`, {
        headers: internalAdminHeaders(), cache: 'no-store', signal: AbortSignal.timeout(15_000)
      }),
      fetch(`${API_URL}/api/v1/workspaces/${workspaceId}/sync`, {
        headers: internalAdminHeaders(), cache: 'no-store', signal: AbortSignal.timeout(15_000)
      })
    ]);
    const setup = await setupResponse.json();
    const sync = syncResponse.ok ? await syncResponse.json() : null;
    if (!setupResponse.ok) return NextResponse.json(setup, { status: setupResponse.status });

    const totalRecords = Number(sync?.freshness?.total_records ?? 0);
    const connected = setup?.hubspot?.status === 'connected';
    const discovered = setup?.latestDiscovery?.status === 'completed';
    const latestRunStatus = String(sync?.latestRun?.status ?? '').toLowerCase();
    const completedRun = ['completed', 'partial'].includes(latestRunStatus);
    const successfulCursors = Array.isArray(sync?.cursors)
      ? sync.cursors.filter((cursor: { last_success_at?: unknown }) => Boolean(cursor?.last_success_at)).length
      : 0;
    const newestRecordSync = sync?.freshness?.newest_record_sync ?? null;
    const synchronized = totalRecords > 0 && (completedRun || successfulCursors > 0 || Boolean(newestRecordSync));

    const activeStartedAt = timestamp(sync?.activeRun?.started_at);
    const latestStartedAt = timestamp(sync?.latestRun?.started_at);
    const now = Date.now();
    const activeRunIsFresh = Boolean(sync?.activeRun) && (activeStartedAt === null || now - activeStartedAt < ACTIVE_SYNC_WINDOW_MS);
    const latestRunIsFresh = ['queued', 'running'].includes(latestRunStatus)
      && (latestStartedAt === null || now - latestStartedAt < ACTIVE_SYNC_WINDOW_MS);
    const syncing = activeRunIsFresh || latestRunIsFresh;

    // A dashboard is usable as soon as synchronized CRM data exists. A current or stale
    // background sync must never lock a customer out of reports that can already be built.
    const ready = connected && discovered && synchronized;

    const steps = [
      { key: 'account', label: 'Account secured', status: 'complete' },
      { key: 'hubspot', label: 'HubSpot connected', status: connected ? 'complete' : 'waiting' },
      { key: 'schema', label: 'CRM structure analyzed', status: discovered ? 'complete' : connected ? 'active' : 'waiting' },
      { key: 'mapping', label: 'Business fields mapped', status: Number(setup?.approvedMappings ?? 0) > 0 ? 'complete' : discovered ? 'active' : 'waiting' },
      { key: 'sync', label: 'Revenue data synchronized', status: synchronized ? 'complete' : syncing ? 'active' : discovered ? 'active' : 'waiting' },
      { key: 'dashboard', label: 'Dashboard ready', status: ready ? 'complete' : synchronized ? 'active' : 'waiting' }
    ];

    return NextResponse.json({
      workspace: access.workspace,
      connected,
      discovered,
      syncing,
      synchronized,
      ready,
      totalRecords,
      successfulCursors,
      approvedMappings: Number(setup?.approvedMappings ?? 0),
      pendingSuggestions: Number(setup?.pendingSuggestions ?? 0),
      latestRun: sync?.latestRun ?? null,
      activeRun: activeRunIsFresh ? sync?.activeRun ?? null : null,
      staleActiveRun: Boolean(sync?.activeRun) && !activeRunIsFresh,
      propertyCounts: setup?.propertyCounts ?? [],
      steps
    });
  } catch (error) {
    return NextResponse.json({ error: 'onboarding_status_unavailable', message: error instanceof Error ? error.message : 'Unable to read onboarding progress.' }, { status: 503 });
  }
}
