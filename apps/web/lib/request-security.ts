const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export type CustomerRequestSecurityDecision =
  | { allowed: true; requestId: string }
  | { allowed: false; requestId: string; status: 403; error: 'cross_site_request_blocked' | 'origin_required' | 'origin_mismatch'; message: string };

export function isSafeHttpMethod(method: string) {
  return SAFE_METHODS.has(String(method || '').toUpperCase());
}

export function normalizeRequestId(value: string | null | undefined) {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : crypto.randomUUID();
}

export function canonicalOrigin(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function evaluateCustomerRequestSecurity(input: {
  method: string;
  requestOrigin: string;
  originHeader?: string | null;
  fetchSite?: string | null;
  requestId?: string | null;
}): CustomerRequestSecurityDecision {
  const requestId = normalizeRequestId(input.requestId);
  if (isSafeHttpMethod(input.method)) return { allowed: true, requestId };

  const fetchSite = String(input.fetchSite ?? '').trim().toLowerCase();
  if (fetchSite === 'cross-site') {
    return {
      allowed: false,
      requestId,
      status: 403,
      error: 'cross_site_request_blocked',
      message: 'Cross-site state-changing requests are not allowed.'
    };
  }

  const suppliedOrigin = canonicalOrigin(input.originHeader);
  if (!suppliedOrigin) {
    return {
      allowed: false,
      requestId,
      status: 403,
      error: 'origin_required',
      message: 'A valid Origin header is required for state-changing customer requests.'
    };
  }

  const expectedOrigin = canonicalOrigin(input.requestOrigin);
  if (!expectedOrigin || suppliedOrigin !== expectedOrigin) {
    return {
      allowed: false,
      requestId,
      status: 403,
      error: 'origin_mismatch',
      message: 'The request origin does not match this application.'
    };
  }

  return { allowed: true, requestId };
}

export const CUSTOMER_SECURITY_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
});
