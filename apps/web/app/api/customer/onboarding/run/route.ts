import { NextRequest, NextResponse } from 'next/server';

import { API_URL, internalAdminHeaders, requireCustomerWorkspace } from '../../session';

type Suggestion = {
  semantic_key: string;
  object_type: string;
  property_name: string;
  confidence: number | string;
  status: string;
};

function autoApprovalCandidates(suggestions: Suggestion[]) {
  const groups = new Map<string, Suggestion[]>();
  for (const suggestion of suggestions.filter((item) => item.status === 'suggested')) {
    const key = `${suggestion.semantic_key}:${suggestion.object_type}`;
    groups.set(key, [...(groups.get(key) ?? []), suggestion]);
  }
  const approved: Suggestion[] = [];
  for (const rows of groups.values()) {
    rows.sort((left, right) => Number(right.confidence) - Number(left.confidence));
    const top = rows[0];
    const runnerUp = rows[1];
    const confidence = Number(top?.confidence ?? 0);
    const margin = confidence - Number(runnerUp?.confidence ?? 0);
    if (top && confidence >= 0.92 && (!runnerUp || margin >= 0.08)) approved.push(top);
  }
  return approved;
}

export async function POST(request: NextRequest) {
  const requestedWorkspaceId = request.nextUrl.searchParams.get('workspaceId') ?? undefined;
  const access = await requireCustomerWorkspace(request, requestedWorkspaceId);
  if (!access.ok) return access.response;
  const workspaceId = access.workspace.id;

  try {
    const discoveryResponse = await fetch(`${API_URL}/api/v1/workspaces/${workspaceId}/hubspot/discover`, {
      method: 'POST',
      headers: internalAdminHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(120_000)
    });
    const discovery = await discoveryResponse.json();
    if (!discoveryResponse.ok) return NextResponse.json(discovery, { status: discoveryResponse.status });

    const suggestionResponse = await fetch(`${API_URL}/api/v1/workspaces/${workspaceId}/mapping-suggestions`, {
      headers: internalAdminHeaders(), cache: 'no-store', signal: AbortSignal.timeout(20_000)
    });
    const suggestionPayload = await suggestionResponse.json();
    if (!suggestionResponse.ok) return NextResponse.json(suggestionPayload, { status: suggestionResponse.status });

    const candidates = autoApprovalCandidates(suggestionPayload.results ?? []);
    const mappings = [];
    for (const candidate of candidates) {
      const response = await fetch(
        `${API_URL}/api/v1/workspaces/${workspaceId}/mappings/${encodeURIComponent(candidate.semantic_key)}/approve`,
        {
          method: 'POST',
          headers: internalAdminHeaders(),
          body: JSON.stringify({ objectType: candidate.object_type, propertyName: candidate.property_name }),
          cache: 'no-store',
          signal: AbortSignal.timeout(15_000)
        }
      );
      if (response.ok) mappings.push(await response.json());
    }

    const syncResponse = await fetch(`${API_URL}/api/v1/workspaces/${workspaceId}/sync`, {
      method: 'POST',
      headers: internalAdminHeaders(),
      body: JSON.stringify({ mode: 'initial' }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000)
    });
    const sync = await syncResponse.json();
    if (!syncResponse.ok && syncResponse.status !== 409) {
      return NextResponse.json(sync, { status: syncResponse.status });
    }

    return NextResponse.json({
      status: 'building',
      workspaceId,
      discovery,
      autoApprovedMappings: mappings.length,
      sync: syncResponse.status === 409 ? { ...sync, status: 'already_running' } : sync
    }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: 'onboarding_run_failed', message: error instanceof Error ? error.message : 'Unable to build the workspace.' }, { status: 503 });
  }
}
