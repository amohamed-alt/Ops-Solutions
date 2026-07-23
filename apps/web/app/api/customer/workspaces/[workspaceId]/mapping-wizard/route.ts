import { NextRequest, NextResponse } from 'next/server';

import { API_URL, customerHeaders, requireCustomerWorkspace } from '../../../session';

const SLOT_PATTERN = /^[a-zA-Z0-9_.:-]{1,160}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function readPayload(response: Response) {
  if (response.status === 204) return null;
  return response.json().catch(() => ({ error: 'invalid_api_response', message: 'The mapping service returned an invalid response.' }));
}

function safeSlot(value: unknown) {
  const token = String(value ?? '').trim();
  return SLOT_PATTERN.test(token) ? token : '';
}

async function forward(request: NextRequest, url: string, init: RequestInit = {}) {
  try {
    const response = await fetch(url, {
      ...init,
      headers: { ...customerHeaders(request), ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000)
    });
    const payload = await readPayload(response);
    if (response.status === 204) return new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    return NextResponse.json(payload, { status: response.status, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({
      error: 'mapping_service_unavailable',
      message: error instanceof Error ? error.message : 'Unable to reach the mapping service.'
    }, { status: 503 });
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;

  const semanticKey = safeSlot(request.nextUrl.searchParams.get('semanticKey'));
  const objectType = safeSlot(request.nextUrl.searchParams.get('objectType'));
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') ?? 30), 1), 100);
  const path = semanticKey && objectType
    ? `/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/mapping-wizard/${encodeURIComponent(semanticKey)}/${encodeURIComponent(objectType)}/history?limit=${limit}`
    : `/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/mapping-wizard`;
  return forward(request, `${API_URL}${path}`);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => ({}));
  const semanticKey = safeSlot(body.semanticKey);
  const objectType = safeSlot(body.objectType);
  const propertyName = safeSlot(body.propertyName);
  if (!semanticKey || !objectType || !propertyName) {
    return NextResponse.json({ error: 'invalid_mapping', message: 'Semantic field, object type, and property are required.' }, { status: 400 });
  }
  return forward(
    request,
    `${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/mapping-wizard/${encodeURIComponent(semanticKey)}/${encodeURIComponent(objectType)}`,
    { method: 'PUT', body: JSON.stringify({ propertyName, valueMapping: body.valueMapping }) }
  );
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => ({}));
  const semanticKey = safeSlot(body.semanticKey);
  const objectType = safeSlot(body.objectType);
  const versionId = String(body.versionId ?? '').trim();
  if (body.action !== 'rollback' || !semanticKey || !objectType || !UUID_PATTERN.test(versionId)) {
    return NextResponse.json({ error: 'invalid_rollback', message: 'A valid mapping slot and version are required.' }, { status: 400 });
  }
  return forward(
    request,
    `${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/mapping-wizard/${encodeURIComponent(semanticKey)}/${encodeURIComponent(objectType)}/rollback/${encodeURIComponent(versionId)}`,
    { method: 'POST', body: '{}' }
  );
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const access = await requireCustomerWorkspace(request, workspaceId);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => ({}));
  const semanticKey = safeSlot(body.semanticKey);
  const objectType = safeSlot(body.objectType);
  if (!semanticKey || !objectType) {
    return NextResponse.json({ error: 'invalid_mapping', message: 'Semantic field and object type are required.' }, { status: 400 });
  }
  return forward(
    request,
    `${API_URL}/api/v1/customer/workspaces/${encodeURIComponent(workspaceId)}/mapping-wizard/${encodeURIComponent(semanticKey)}/${encodeURIComponent(objectType)}`,
    { method: 'DELETE', body: '{}' }
  );
}
