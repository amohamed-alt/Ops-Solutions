export async function GET() {
  return Response.json({
    status: 'healthy',
    service: 'web',
    timestamp: new Date().toISOString()
  });
}
