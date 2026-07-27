export const READINESS_WEIGHTS = Object.freeze({
  hubspotConnection: 30,
  dataSync: 25,
  analyticsAssets: 15,
  scheduledDelivery: 10,
  taskWrite: 10,
  lifecycleWrite: 10
});

function hasRecentSync(value, now = Date.now()) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return now - timestamp <= 24 * 60 * 60 * 1000;
}

export function calculateWorkspaceReadiness(input, now = Date.now()) {
  const connected = input?.hubspotStatus === 'connected';
  const recentlySynced = connected && hasRecentSync(input?.newestRecordSync, now);
  const hasAnalyticsAssets = Number(input?.savedViewCount || 0) > 0;
  const hasScheduledDelivery = Number(input?.scheduleCount || 0) > 0;
  const canCreateTask = Boolean(input?.canCreateTask);
  const canUpdateLifecycleStage = Boolean(input?.canUpdateLifecycleStage);

  const checks = [
    {
      key: 'hubspotConnection',
      label: 'HubSpot connection',
      ready: connected,
      weight: READINESS_WEIGHTS.hubspotConnection,
      detail: connected ? 'Connected and available to the workspace.' : 'Connect HubSpot before reports can synchronize.'
    },
    {
      key: 'dataSync',
      label: 'Data freshness',
      ready: recentlySynced,
      weight: READINESS_WEIGHTS.dataSync,
      detail: recentlySynced
        ? 'CRM records synchronized during the last 24 hours.'
        : connected
          ? 'No successful record synchronization was detected during the last 24 hours.'
          : 'Waiting for a HubSpot connection.'
    },
    {
      key: 'analyticsAssets',
      label: 'Analytics configuration',
      ready: hasAnalyticsAssets,
      weight: READINESS_WEIGHTS.analyticsAssets,
      detail: hasAnalyticsAssets
        ? `${Number(input.savedViewCount)} saved reporting asset${Number(input.savedViewCount) === 1 ? '' : 's'} available.`
        : 'Create at least one saved report or dashboard definition.'
    },
    {
      key: 'scheduledDelivery',
      label: 'Scheduled delivery',
      ready: hasScheduledDelivery,
      weight: READINESS_WEIGHTS.scheduledDelivery,
      detail: hasScheduledDelivery
        ? `${Number(input.scheduleCount)} recurring report schedule${Number(input.scheduleCount) === 1 ? '' : 's'} configured.`
        : 'No recurring executive report schedule is configured yet.'
    },
    {
      key: 'taskWrite',
      label: 'Task write permission',
      ready: canCreateTask,
      weight: READINESS_WEIGHTS.taskWrite,
      optional: true,
      detail: canCreateTask ? 'HubSpot task creation is enabled.' : 'Reconnect HubSpot with the optional task write scope to enable this action.'
    },
    {
      key: 'lifecycleWrite',
      label: 'Lifecycle write permission',
      ready: canUpdateLifecycleStage,
      weight: READINESS_WEIGHTS.lifecycleWrite,
      optional: true,
      detail: canUpdateLifecycleStage ? 'Contact lifecycle updates are enabled.' : 'Reconnect HubSpot with the optional contact write scope to enable this action.'
    }
  ];

  const score = checks.reduce((total, check) => total + (check.ready ? check.weight : 0), 0);
  const requiredChecks = checks.filter((check) => !check.optional);
  const requiredReady = requiredChecks.every((check) => check.ready);
  const state = requiredReady && score >= 80
    ? 'ready'
    : connected
      ? 'needs_attention'
      : 'blocked';

  return {
    score,
    state,
    requiredReady,
    checks,
    readyCount: checks.filter((check) => check.ready).length,
    totalCount: checks.length
  };
}
