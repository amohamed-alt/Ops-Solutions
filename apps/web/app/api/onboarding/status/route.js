import { NextResponse } from 'next/server';
import { adminHeaders } from '../../operations/auth';
import { readOnboardingSession } from '../session';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://api:3001';

export async function GET(request) {
  const session = readOnboardingSession(request);
  if (!session) {
    return NextResponse.json({ error: 'onboarding_session_invalid', message: 'Your onboarding session has expired.' }, { status: 401 });
  }

  try {
    const setupResponse = await fetch(`${API_URL}/api/v1/workspaces/${session.workspaceId}/setup`, {
      headers: adminHeaders(), cache: 'no-store', signal: AbortSignal.timeout(10000)
    });
    const syncResponse = await fetch(`${API_URL}/api/v1/workspaces/${session.workspaceId}/sync`, {
      headers: adminHeaders(), cache: 'no-store', signal: AbortSignal.timeout(10000)
    });
    const setup = await setupResponse.json();
    const sync = await syncResponse.json();
    if (!setupResponse.ok) return NextResponse.json(setup, { status: setupResponse.status });
    if (!syncResponse.ok) return NextResponse.json(sync, { status: syncResponse.status });

    const totalRecords = Number(sync.freshness?.total_records ?? 0);
    const latestStatus = sync.latestRun?.status ?? null;
    return NextResponse.json({
      workspace: setup.workspace,
      hubspot: setup.hubspot,
      discovery: setup.latestDiscovery,
      propertyCounts: setup.propertyCounts,
      approvedMappings: setup.approvedMappings,
      pendingSuggestions: setup.pendingSuggestions,
      sync: {
        initialized: sync.initialized,
        activeRun: sync.activeRun,
        latestRun: sync.latestRun,
        recordCounts: sync.recordCounts,
        freshness: sync.freshness
      },
      ready: setup.hubspot?.status === 'connected' && latestStatus === 'completed' && totalRecords > 0
    });
  } catch (error) {
    return NextResponse.json({ error: 'onboarding_status_unavailable', message: error.message }, { status: 503 });
  }
}
