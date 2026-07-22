import { NextResponse } from 'next/server';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://api:3001';

function adminHeaders(extra = {}) {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    throw new Error('ADMIN_API_KEY is not configured for the web runtime');
  }

  return {
    'x-admin-key': adminKey,
    ...extra
  };
}

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

export async function GET(_request, { params }) {
  try {
    const { workspaceId } = await params;
    const response = await fetch(`${API_URL}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/sync`, {
      headers: adminHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000)
    });
    return forward(response);
  } catch (error) {
    return NextResponse.json({
      error: 'sync_operations_unavailable',
      message: error.message
    }, { status: 503 });
  }
}

export async function POST(request, { params }) {
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
    return NextResponse.json({
      error: 'sync_operation_failed',
      message: error.message
    }, { status: 503 });
  }
}
