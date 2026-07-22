import { NextRequest, NextResponse } from 'next/server';

export const CUSTOMER_SESSION_COOKIE = 'ops_customer_session';
export const API_URL = process.env.API_INTERNAL_URL ?? 'http://api:3001';

export function internalAdminHeaders() {
  return {
    'content-type': 'application/json',
    'x-admin-key': process.env.ADMIN_API_KEY ?? ''
  };
}

export function sessionToken(request: NextRequest) {
  return request.cookies.get(CUSTOMER_SESSION_COOKIE)?.value ?? '';
}

export function customerHeaders(request: NextRequest) {
  return {
    'content-type': 'application/json',
    'x-session-token': sessionToken(request)
  };
}

export function setCustomerSession(response: NextResponse, token: string) {
  response.cookies.set(CUSTOMER_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30
  });
  return response;
}

export function clearCustomerSession(response: NextResponse) {
  response.cookies.set(CUSTOMER_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0
  });
  return response;
}

export async function getCustomerContext(request: NextRequest) {
  const token = sessionToken(request);
  if (!token) return null;
  const response = await fetch(`${API_URL}/api/v1/auth/session`, {
    headers: customerHeaders(request),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) return null;
  return response.json();
}

export async function requireCustomerWorkspace(request: NextRequest, workspaceId?: string) {
  const context = await getCustomerContext(request);
  if (!context) {
    return { ok: false as const, response: NextResponse.json({ error: 'session_required', message: 'Sign in to continue.' }, { status: 401 }) };
  }
  const workspace = workspaceId
    ? context.workspaces?.find((item: { id: string }) => item.id === workspaceId)
    : context.workspaces?.[0];
  if (!workspace) {
    return { ok: false as const, response: NextResponse.json({ error: 'workspace_forbidden', message: 'This workspace is not available to your account.' }, { status: 403 }) };
  }
  return { ok: true as const, context, workspace };
}
