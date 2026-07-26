export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(
    {
      service: 'web',
      release: process.env.RELEASE_SHA || 'unknown',
      deployedAt: process.env.RELEASE_DEPLOYED_AT || null,
      timestamp: new Date().toISOString()
    },
    {
      headers: {
        'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        pragma: 'no-cache',
        expires: '0'
      }
    }
  );
}
