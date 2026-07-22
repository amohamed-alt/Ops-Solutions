import { NextRequest, NextResponse } from 'next/server';

import { getCustomerContext } from '../../session';

export async function GET(request: NextRequest) {
  const context = await getCustomerContext(request);
  if (!context) return NextResponse.json({ authenticated: false }, { status: 401 });
  return NextResponse.json({ authenticated: true, ...context });
}
