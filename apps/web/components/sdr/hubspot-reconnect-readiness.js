export const GUARDED_WRITE_SCOPES = Object.freeze([
  'crm.objects.tasks.write',
  'crm.objects.contacts.write'
]);

export function evaluateHubSpotReconnectReadiness({ workspace, capabilities }) {
  const connected = workspace?.hubspot_status === 'connected' && capabilities?.connected !== false;
  const grantedScopes = new Set((capabilities?.scopes ?? []).map((scope) => String(scope)));
  const missingWriteScopes = GUARDED_WRITE_SCOPES.filter((scope) => !grantedScopes.has(scope));
  const canCreateTask = Boolean(capabilities?.can?.createTask);
  const canUpdateLifecycleStage = Boolean(capabilities?.can?.updateLifecycleStage);
  const writeReady = connected && missingWriteScopes.length === 0 && canCreateTask && canUpdateLifecycleStage;

  let state = 'disconnected';
  let label = 'Connection required';
  let description = 'Connect this workspace to HubSpot before CRM analytics or guarded write actions can run.';

  if (connected && writeReady) {
    state = 'ready';
    label = 'Read/write ready';
    description = 'The workspace has the guarded write scopes required for task creation and lifecycle updates.';
  } else if (connected) {
    state = 'reconnect_required';
    label = 'Reconnect required';
    description = 'Read analytics can continue, but guarded write actions need a new HubSpot consent grant.';
  }

  return {
    state,
    label,
    description,
    connected,
    readReady: connected,
    writeReady,
    canCreateTask,
    canUpdateLifecycleStage,
    missingWriteScopes,
    grantedScopes: [...grantedScopes]
  };
}
