export function missingHubSpotScopes(capabilities) {
  if (!capabilities) return [];
  const required = new Set(Object.values(capabilities.requiredScopes ?? {}).flat());
  return [...required].filter((scope) => !(capabilities.scopes ?? []).includes(scope)).sort();
}

export function summarizeHubSpotAccess(rows) {
  const connected = rows.filter((row) => row.workspace?.hubspot_status === 'connected').length;
  const ready = rows.filter((row) => row.capabilities && missingHubSpotScopes(row.capabilities).length === 0).length;
  return {
    connected,
    ready,
    needsReconnect: Math.max(0, connected - ready)
  };
}
