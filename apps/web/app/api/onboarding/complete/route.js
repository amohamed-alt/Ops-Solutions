import { NextResponse } from 'next/server';
import { adminHeaders } from '../../operations/auth';
import { readOnboardingSession } from '../session';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://api:3001';

async function readJson(response) {
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

export async function POST(request) {
  const session = readOnboardingSession(request);
  if (!session) {
    return NextResponse.json({ error: 'onboarding_session_invalid', message: 'Your onboarding session has expired.' }, { status: 401 });
  }

  try {
    const discovery = await readJson(await fetch(`${API_URL}/api/v1/workspaces/${session.workspaceId}/hubspot/discover`, {
      method: 'POST',
      headers: adminHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(120000)
    }));
    if (!discovery.response.ok) return NextResponse.json(discovery.payload, { status: discovery.response.status });

    const sync = await readJson(await fetch(`${API_URL}/api/v1/workspaces/${session.workspaceId}/sync`, {
      method: 'POST',
      headers: adminHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ mode: 'initial' }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000)
    }));

    const acceptableConflict = sync.response.status === 409 && ['sync_already_running'].includes(sync.payload.error);
    if (!sync.response.ok && !acceptableConflict) {
      return NextResponse.json(sync.payload, { status: sync.response.status });
    }

    return NextResponse.json({
      status: 'processing',
      workspaceId: session.workspaceId,
      discovery: discovery.payload,
      sync: sync.payload
    }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: 'onboarding_completion_failed', message: error.message }, { status: 503 });
  }
}
