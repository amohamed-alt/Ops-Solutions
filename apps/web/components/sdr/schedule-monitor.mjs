export function scheduleHealth(schedule, now = new Date()) {
  if (!schedule?.enabled) {
    return { state: 'paused', label: 'Paused', detail: 'This schedule will not run until it is resumed.' };
  }

  if (schedule.lastFailureAt && (!schedule.lastSuccessAt || new Date(schedule.lastFailureAt) > new Date(schedule.lastSuccessAt))) {
    return {
      state: 'failed',
      label: 'Needs attention',
      detail: schedule.lastError || 'The latest scheduled delivery failed.'
    };
  }

  if (schedule.nextRunAt && new Date(schedule.nextRunAt).getTime() < now.getTime() - 5 * 60_000) {
    return {
      state: 'delayed',
      label: 'Delayed',
      detail: 'The next run time has passed. Check the worker and delivery provider.'
    };
  }

  if (schedule.lastSuccessAt) {
    return { state: 'healthy', label: 'Healthy', detail: 'The latest recorded delivery completed successfully.' };
  }

  return { state: 'pending', label: 'Waiting for first run', detail: 'The schedule is enabled and has no completed delivery yet.' };
}

export function scheduleUpdatePayload(schedule, enabled) {
  if (!schedule?.savedViewId) throw new TypeError('Schedule is missing its saved view.');
  return {
    name: schedule.name,
    savedViewId: schedule.savedViewId,
    frequency: schedule.frequency,
    timezone: schedule.timezone,
    recipients: Array.isArray(schedule.recipients) ? schedule.recipients : [],
    format: schedule.format,
    deliveryMode: schedule.deliveryMode,
    deliveryHour: Number(schedule.deliveryHour),
    deliveryMinute: Number(schedule.deliveryMinute),
    weekday: schedule.weekday === null || schedule.weekday === undefined ? undefined : Number(schedule.weekday),
    monthday: schedule.monthday === null || schedule.monthday === undefined ? undefined : Number(schedule.monthday),
    enabled
  };
}

export function executionStatusLabel(execution) {
  const delivery = String(execution?.delivery_status ?? '').trim();
  const status = String(execution?.status ?? '').trim();
  if (delivery === 'delivered' || status === 'delivered') return 'Delivered';
  if (status === 'failed') return 'Failed';
  if (delivery === 'provider_not_configured') return 'Provider not configured';
  if (status === 'exporting') return 'Preparing export';
  if (status === 'ready_for_delivery') return 'Ready for delivery';
  if (status === 'queued') return 'Queued';
  if (status === 'skipped') return 'Skipped';
  return status.replaceAll('_', ' ') || 'Unknown';
}
