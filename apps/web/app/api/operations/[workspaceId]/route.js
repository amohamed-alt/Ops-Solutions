import { NextResponse } from 'next/server';

import { adminHeaders, requireOperationsAccess } from '../auth';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://api:3001';

async function forward(response) {
  const text = await response.text();
  let payload;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { error: 'invalid_upstream_response', message: text || 'The API returned an empty response.' };
  }

  return NextResponse.json(payload, { status: response.status });
}

function unauthorized(access) {
  return NextResponse.json({ error: 'operations_access_denied', message: access.message }, { status: access.status });
}

export async function GET(request, { params }) {
  const access = requireOperationsAccess(request);
  if (!access.ok) return unauthorized(access);

  try {
    const { workspaceId } = await params;
    const response = await fetch(`${API_URL}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/sync`, {
      headers: adminHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000)
    });
    return forward(response);
  } catch (error) {
    return NextResponse.json({ error: 'sync_operations_unavailable', message: error.message }, { status: 503 });
  }
}

export async function POST(request, { params }) {
  const access = requireOperationsAccess(request);
  if (!access.ok) return unauthorized(access);

  try {
    const { workspaceId } = await params;
    const body = await request.json();
    const response = await fetch(`${API_URL}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/sync`, {
      method: 'POST',
      headers: adminHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ mode: body?.mode }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000)
    });
    return forward(response);
  } catch (error) {
    return NextResponse.json({ error: 'sync_operation_failed', message: error.message }, { status: 503 });
  }
}
