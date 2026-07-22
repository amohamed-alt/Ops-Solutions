import { timingSafeEqual } from 'node:crypto';

export function requireOperationsAccess(request) {
  const expected = process.env.OPERATIONS_ACCESS_KEY ?? '';
  const supplied = request.headers.get('x-operations-key') ?? '';

  if (!expected) {
    return { ok: false, status: 503, message: 'OPERATIONS_ACCESS_KEY is not configured.' };
  }

  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  const valid = left.length === right.length && timingSafeEqual(left, right);

  return valid
    ? { ok: true }
    : { ok: false, status: 401, message: 'Invalid operations access key.' };
}

export function adminHeaders(extra = {}) {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) throw new Error('ADMIN_API_KEY is not configured for the web runtime');
  return { 'x-admin-key': adminKey, ...extra };
}
