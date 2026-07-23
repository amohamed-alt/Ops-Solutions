import { NextRequest, NextResponse } from 'next/server';

import { API_URL, internalAdminHeaders, requireCustomerWorkspace } from '../../../session';

const ADMIN_ROLES = new Set(['owner', 'admin']);
const SYNC_MODES = new Set(['incremental', 'full']);

async function readJson(response: Response) {
  return response.json().catch(() => ({}));
}

function requireAdminRole(role: string) {
  if (ADMIN_ROLES.has(role)) return null;
  return NextResponse.json({ error: 'workspace_role_required', message: 'Admin access is required for HubSpot operations.' }, { status: 403 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;

  try {
    const [setupResponse, syncResponse] = await Promise.all([
      fetch(`${API_URL}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/setup`, {
        headers: internalAdminHeaders(), cache: 'no-store', signal: AbortSignal.timeout(15_000)
      }),
      fetch(`${API_URL}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/sync`, {
        headers: internalAdminHeaders(), cache: 'no-store', signal: AbortSignal.timeout(15_000)
      })
    ]);
    const setup = await readJson(setupResponse);
    const sync = await readJson(syncResponse);
    if (!setupResponse.ok) return NextResponse.json(setup, { status: setupResponse.status });
    if (!syncResponse.ok && syncResponse.status !== 404) return NextResponse.json(sync, { status: syncResponse.status });

    const totalRecords = Number(sync?.freshness?.total_records ?? 0);
    const newestSync = sync?.freshness?.newest_record_sync ?? null;
    const ageMs = newestSync ? Date.now() - new Date(newestSync).getTime() : Number.POSITIVE_INFINITY;
    const connected = setup?.hubspot?.status === 'connected';
    const activeRun = sync?.activeRun ?? null;
    const latestRun = sync?.latestRun ?? null;
    const webhookFailures = Number(sync?.webhooks?.failed24h ?? 0);
    let health = { status: 'healthy', severity: 'success', message: 'HubSpot and synchronized CRM data are healthy.' };
    if (!connected) health = { status: 'disconnected', severity: 'critical', message: 'HubSpot is not connected to this company.' };
    else if (activeRun) health = { status: 'syncing', severity: 'info', message: `A ${activeRun.mode || 'CRM'} synchronization is running.` };
    else if (webhookFailures > 0) health = { status: 'degraded', severity: 'warning', message: `${webhookFailures} HubSpot webhook event${webhookFailures === 1 ? '' : 's'} failed during the last 24 hours.` };
    else if (setup?.hubspot?.lastError || latestRun?.status === 'failed') health = { status: 'degraded', severity: 'warning', message: setup?.hubspot?.lastError || latestRun?.error || 'The latest synchronization failed.' };
    else if (!totalRecords) health = { status: 'initializing', severity: 'warning', message: 'HubSpot is connected but no CRM records have been synchronized yet.' };
    else if (!Number.isFinite(ageMs) || ageMs > 24 * 60 * 60 * 1000) health = { status: 'stale', severity: 'warning', message: 'CRM data has not refreshed during the last 24 hours.' };

    return NextResponse.json({
      workspace: access.workspace,
      health,
      hubspot: setup?.hubspot ?? null,
      propertyCounts: setup?.propertyCounts ?? [],
      approvedMappings: Number(setup?.approvedMappings ?? 0),
      pendingSuggestions: Number(setup?.pendingSuggestions ?? 0),
      latestDiscovery: setup?.latestDiscovery ?? null,
      sync: {
        initialized: Boolean(sync?.initialized),
        activeRun,
        latestRun,
        cursors: sync?.cursors ?? [],
        recordCounts: sync?.recordCounts ?? [],
        freshness: sync?.freshness ?? null,
        webhooks: sync?.webhooks ?? {
          initialized: false,
          received24h: 0,
          failed24h: 0,
          latestReceivedAt: null,
          latestStatus: null
        }
      }
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: 'workspace_operations_unavailable', message: error instanceof Error ? error.message : 'Unable to load workspace operations.' }, { status: 503 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;
  const forbidden = requireAdminRole(access.workspace.role);
  if (forbidden) return forbidden;

  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? '').trim();
  let url = '';
  let method = 'POST';
  let payload: Record<string, unknown> | undefined;

  if (action === 'discover') {
    url = `${API_URL}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/hubspot/discover`;
  } else if (action === 'sync') {
    const mode = String(body.mode ?? 'incremental').trim().toLowerCase();
    if (!SYNC_MODES.has(mode)) return NextResponse.json({ error: 'invalid_sync_mode', message: 'Sync mode must be incremental or full.' }, { status: 400 });
    url = `${API_URL}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/sync`;
    payload = { mode };
  } else if (action === 'reconnect') {
    method = 'GET';
    const returnTo = `/settings/workspace?workspaceId=${encodeURIComponent(workspaceId)}`;
    url = `${API_URL}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/hubspot/oauth/start?returnTo=${encodeURIComponent(returnTo)}`;
  } else {
    return NextResponse.json({ error: 'invalid_operation', message: 'Choose discover, sync, or reconnect.' }, { status: 400 });
  }

  try {
    const response = await fetch(url, {
      method,
      headers: internalAdminHeaders(payload ? { 'content-type': 'application/json' } : {}),
      body: payload ? JSON.stringify(payload) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(action === 'discover' ? 120_000 : 20_000)
    });
    const result = await readJson(response);
    return NextResponse.json(result, { status: response.status, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: 'workspace_operation_failed', message: error instanceof Error ? error.message : 'Workspace operation failed.' }, { status: 503 });
  }
}
