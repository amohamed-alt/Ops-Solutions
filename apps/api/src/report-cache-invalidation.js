import Redis from 'ioredis';

export const REPORT_CACHE_INVALIDATION_CHANNEL = 'ops-solutions:report-cache:invalidate';
const WORKSPACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseReportCacheInvalidation(message) {
  let payload;
  try {
    payload = JSON.parse(String(message ?? ''));
  } catch {
    return null;
  }
  const workspaceId = String(payload?.workspaceId ?? '').trim();
  if (!WORKSPACE_ID_PATTERN.test(workspaceId)) return null;
  return {
    workspaceId,
    reason: String(payload?.reason ?? 'crm_data_changed').slice(0, 120),
    occurredAt: String(payload?.occurredAt ?? '').slice(0, 40) || null,
    objectTypes: Array.isArray(payload?.objectTypes)
      ? payload.objectTypes.map((value) => String(value).slice(0, 100)).slice(0, 50)
      : []
  };
}

export function startReportCacheInvalidationSubscriber({ redisUrl, clearWorkspace, log = console } = {}) {
  if (!redisUrl || typeof clearWorkspace !== 'function') {
    return { close: async () => undefined, ready: Promise.resolve(false) };
  }

  const subscriber = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true
  });
  let closing = false;

  subscriber.on('message', (channel, message) => {
    if (channel !== REPORT_CACHE_INVALIDATION_CHANNEL) return;
    const event = parseReportCacheInvalidation(message);
    if (!event) {
      log.warn?.({ channel }, 'Ignored malformed report cache invalidation event');
      return;
    }
    clearWorkspace(event.workspaceId);
    log.info?.({
      workspaceId: event.workspaceId,
      reason: event.reason,
      objectTypes: event.objectTypes
    }, 'Report cache invalidated after CRM data change');
  });

  subscriber.on('error', (error) => {
    if (!closing) log.error?.({ error }, 'Report cache invalidation subscriber error');
  });

  const ready = subscriber.connect()
    .then(() => subscriber.subscribe(REPORT_CACHE_INVALIDATION_CHANNEL))
    .then(() => true)
    .catch((error) => {
      log.error?.({ error }, 'Report cache invalidation subscriber could not start');
      return false;
    });

  return {
    ready,
    async close() {
      closing = true;
      try {
        await subscriber.unsubscribe(REPORT_CACHE_INVALIDATION_CHANNEL);
      } catch {
        // The connection may already be closed during process shutdown.
      }
      try {
        await subscriber.quit();
      } catch {
        subscriber.disconnect();
      }
    }
  };
}
