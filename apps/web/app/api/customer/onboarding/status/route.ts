import { NextRequest, NextResponse } from 'next/server';

import { API_URL, internalAdminHeaders, requireCustomerWorkspace } from '../../session';

export async function GET(request: NextRequest) {
  const access = await requireCustomerWorkspace(request);
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
    const syncing = Boolean(sync?.activeRun) || ['queued', 'running'].includes(sync?.latestRun?.status);
    const completed = ['completed', 'partial'].includes(sync?.latestRun?.status) && totalRecords > 0;
    const ready = connected && discovered && completed;

    const steps = [
      { key: 'account', label: 'Account secured', status: 'complete' },
      { key: 'hubspot', label: 'HubSpot connected', status: connected ? 'complete' : 'waiting' },
      { key: 'schema', label: 'CRM structure analyzed', status: discovered ? 'complete' : connected ? 'active' : 'waiting' },
      { key: 'mapping', label: 'Business fields mapped', status: Number(setup?.approvedMappings ?? 0) > 0 ? 'complete' : discovered ? 'active' : 'waiting' },
      { key: 'sync', label: 'Revenue data synchronized', status: completed ? 'complete' : syncing ? 'active' : discovered ? 'active' : 'waiting' },
      { key: 'dashboard', label: 'Dashboard ready', status: ready ? 'complete' : 'waiting' }
    ];

    return NextResponse.json({
      workspace: access.workspace,
      connected,
      discovered,
      syncing,
      ready,
      totalRecords,
      approvedMappings: Number(setup?.approvedMappings ?? 0),
      pendingSuggestions: Number(setup?.pendingSuggestions ?? 0),
      latestRun: sync?.latestRun ?? null,
      activeRun: sync?.activeRun ?? null,
      propertyCounts: setup?.propertyCounts ?? [],
      steps
    });
  } catch (error) {
    return NextResponse.json({ error: 'onboarding_status_unavailable', message: error instanceof Error ? error.message : 'Unable to read onboarding progress.' }, { status: 503 });
  }
}
