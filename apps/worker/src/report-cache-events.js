export const REPORT_CACHE_INVALIDATION_CHANNEL = 'ops-solutions:report-cache:invalidate';
const WORKSPACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function publishReportCacheInvalidation(redis, {
  workspaceId,
  reason = 'crm_data_changed',
  objectTypes = []
} = {}) {
  const normalizedWorkspaceId = String(workspaceId ?? '').trim();
  if (!WORKSPACE_ID_PATTERN.test(normalizedWorkspaceId)) {
    throw new Error('A valid workspaceId is required for report cache invalidation.');
  }
  const payload = JSON.stringify({
    version: 1,
    workspaceId: normalizedWorkspaceId,
    reason: String(reason).slice(0, 120),
    objectTypes: Array.isArray(objectTypes)
      ? objectTypes.map((value) => String(value).slice(0, 100)).slice(0, 50)
      : [],
    occurredAt: new Date().toISOString()
  });
  return redis.publish(REPORT_CACHE_INVALIDATION_CHANNEL, payload);
}

export async function runWithReportInvalidation(redis, event, task) {
  try {
    const result = await task();
    await publishReportCacheInvalidation(redis, {
      ...event,
      objectTypes: event.objectTypes?.length
        ? event.objectTypes
        : result?.summary?.completed?.map((row) => row.objectType) ?? result?.objectTypes ?? []
    });
    return result;
  } catch (error) {
    // A partial synchronization can persist valid CRM changes before surfacing an error.
    // Publishing on failure is therefore intentionally conservative and only evicts cache.
    try {
      await publishReportCacheInvalidation(redis, {
        ...event,
        reason: `${event.reason || 'crm_data_changed'}_with_error`,
        objectTypes: error?.summary?.completed?.map((row) => row.objectType) ?? event.objectTypes ?? []
      });
    } catch {
      // Preserve the original synchronization error.
    }
    throw error;
  }
}
