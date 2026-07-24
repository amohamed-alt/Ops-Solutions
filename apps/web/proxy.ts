import { NextRequest, NextResponse } from 'next/server';

import { CUSTOMER_SECURITY_HEADERS, evaluateCustomerRequestSecurity } from './lib/request-security';

function applySecurityHeaders(response: NextResponse, requestId: string) {
  response.headers.set('x-request-id', requestId);
  response.headers.set('cache-control', 'no-store, max-age=0');
  for (const [name, value] of Object.entries(CUSTOMER_SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

export function proxy(request: NextRequest) {
  const decision = evaluateCustomerRequestSecurity({
    method: request.method,
    requestOrigin: request.nextUrl.origin,
    originHeader: request.headers.get('origin'),
    fetchSite: request.headers.get('sec-fetch-site'),
    requestId: request.headers.get('x-request-id')
  });

  if (!decision.allowed) {
    return applySecurityHeaders(NextResponse.json({
      error: decision.error,
      message: decision.message,
      requestId: decision.requestId
    }, { status: decision.status }), decision.requestId);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-request-id', decision.requestId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  return applySecurityHeaders(response, decision.requestId);
}

export const config = {
  matcher: ['/api/customer/:path*']
};
