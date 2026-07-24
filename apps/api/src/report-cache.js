const DEFAULT_MAX_ENTRIES = 500;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function refreshRequested(query = {}) {
  const value = String(query.refresh ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'force'].includes(value);
}

export function normalizedReportQuery(query = {}) {
  return Object.entries(query)
    .filter(([key, value]) => key !== 'refresh' && value !== undefined && value !== null && String(value).trim() !== '')
    .map(([key, value]) => [String(key), String(value).slice(0, 500)])
    .sort(([left], [right]) => left.localeCompare(right));
}

export function reportCacheKey(namespace, workspaceId, query = {}, parts = []) {
  return JSON.stringify([
    String(namespace),
    String(workspaceId),
    ...parts.map((part) => String(part)),
    normalizedReportQuery(query)
  ]);
}

export function createReportCache({ maxEntries = DEFAULT_MAX_ENTRIES, now = () => Date.now() } = {}) {
  const resolved = new Map();
  const inflight = new Map();
  const capacity = positiveInteger(maxEntries, DEFAULT_MAX_ENTRIES);

  function deleteExpired(timestamp = now()) {
    for (const [key, entry] of resolved) {
      if (entry.expiresAt <= timestamp) resolved.delete(key);
    }
  }

  function enforceCapacity() {
    while (resolved.size > capacity) {
      const oldestKey = resolved.keys().next().value;
      if (oldestKey === undefined) break;
      resolved.delete(oldestKey);
    }
  }

  async function execute({ key, ttlMs, query, loader }) {
    const startedAt = now();
    const bypass = refreshRequested(query);
    deleteExpired(startedAt);

    if (!bypass) {
      const cached = resolved.get(key);
      if (cached && cached.expiresAt > startedAt) {
        resolved.delete(key);
        resolved.set(key, cached);
        return { value: cached.value, status: 'HIT', durationMs: Math.max(0, now() - startedAt) };
      }

      const pending = inflight.get(key);
      if (pending) {
        const value = await pending;
        return { value, status: 'COALESCED', durationMs: Math.max(0, now() - startedAt) };
      }
    }

    const work = Promise.resolve().then(loader);
    inflight.set(key, work);
    try {
      const value = await work;
      resolved.set(key, {
        value,
        expiresAt: now() + positiveInteger(ttlMs, 30_000)
      });
      enforceCapacity();
      return {
        value,
        status: bypass ? 'REFRESH' : 'MISS',
        durationMs: Math.max(0, now() - startedAt)
      };
    } finally {
      if (inflight.get(key) === work) inflight.delete(key);
    }
  }

  function clearWorkspace(workspaceId) {
    const marker = `\"${String(workspaceId)}\"`;
    for (const key of resolved.keys()) {
      if (key.includes(marker)) resolved.delete(key);
    }
  }

  function stats() {
    deleteExpired();
    return { resolved: resolved.size, inflight: inflight.size, maxEntries: capacity };
  }

  return { execute, clearWorkspace, stats };
}

export function applyReportTimingHeaders(reply, result) {
  if (!reply || typeof reply.header !== 'function') return;
  reply.header('cache-control', 'private, no-store');
  reply.header('x-report-cache', result.status);
  reply.header('server-timing', `report;dur=${Math.max(0, Number(result.durationMs) || 0)}`);
}
