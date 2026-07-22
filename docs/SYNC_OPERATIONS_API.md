# Sync Operations API

The administrative sync API provides tenant-scoped visibility and recovery controls for HubSpot synchronization. It is protected by `x-admin-key` until end-user authentication and workspace roles are implemented.

## Read sync health

```bash
curl --fail-with-body \
  --url "http://127.0.0.1:3211/api/v1/workspaces/$WORKSPACE_ID/sync" \
  --header "x-admin-key: $ADMIN_API_KEY"
```

The response includes:

- Active and latest sync runs
- Per-object cursors and last successful timestamps
- Record and archived-record counts by object type
- Oldest and newest persisted sync timestamps
- Whether the worker sync schema has been initialized

## Trigger a sync

```bash
curl --fail-with-body \
  --request POST \
  --url "http://127.0.0.1:3211/api/v1/workspaces/$WORKSPACE_ID/sync" \
  --header "x-admin-key: $ADMIN_API_KEY" \
  --header 'content-type: application/json' \
  --data '{"mode":"full"}'
```

Supported modes:

- `initial` — forces a complete first-load style synchronization
- `incremental` — runs the normal cursor-aware synchronization path
- `full` — forces full reconciliation and association refresh

The endpoint returns `202 Accepted` after a BullMQ job is queued. It refuses to start when the workspace has no connected HubSpot portal or another sync run is already active.

## Safety controls

- All queries are scoped by `workspace_id`.
- Only a fixed allowlist of sync modes is accepted.
- Duplicate requests in the same minute use the same deterministic BullMQ job ID.
- Active-run conflict protection prevents overlapping writes for one workspace.
- Queue retries and retention match the production worker configuration.
- HubSpot credentials and OAuth tokens are never returned.
