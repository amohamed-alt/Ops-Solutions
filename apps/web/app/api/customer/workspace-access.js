function normalizedWorkspaceId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function selectCustomerWorkspace(context, requestedWorkspaceId) {
  const workspaces = Array.isArray(context?.workspaces) ? context.workspaces : [];
  const requestedId = normalizedWorkspaceId(requestedWorkspaceId);

  if (!requestedId) {
    return workspaces[0] ?? null;
  }

  return workspaces.find((workspace) => normalizedWorkspaceId(workspace?.id) === requestedId) ?? null;
}

export function canAccessCustomerWorkspace(context, requestedWorkspaceId) {
  return Boolean(selectCustomerWorkspace(context, requestedWorkspaceId));
}
