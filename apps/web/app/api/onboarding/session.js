import { createHmac, timingSafeEqual } from 'node:crypto';

export const ONBOARDING_COOKIE = 'ops_onboarding';
const SESSION_TTL_SECONDS = 60 * 60 * 24;

function secret() {
  const value = process.env.ONBOARDING_SESSION_SECRET || process.env.OPERATIONS_ACCESS_KEY || '';
  if (!value) throw new Error('ONBOARDING_SESSION_SECRET or OPERATIONS_ACCESS_KEY must be configured');
  return value;
}

function signature(payload) {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function createOnboardingSession({ workspaceId, email }) {
  const payload = Buffer.from(JSON.stringify({
    workspaceId,
    email,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function readOnboardingSession(request) {
  const token = request.cookies.get(ONBOARDING_COOKIE)?.value || '';
  const [payload, suppliedSignature] = token.split('.');
  if (!payload || !suppliedSignature) return null;

  const expectedSignature = signature(payload);
  const left = Buffer.from(expectedSignature);
  const right = Buffer.from(suppliedSignature);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session.workspaceId || !session.email || Number(session.exp) <= Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

export function onboardingCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS
  };
}
