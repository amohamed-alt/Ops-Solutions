# Saved reporting views

Saved views are private reporting configurations scoped to both a workspace and the signed-in user. Every route requires a valid customer session and verifies workspace membership before running a database query.

## API

- `GET /api/v1/customer/workspaces/:workspaceId/saved-views`
- `POST /api/v1/customer/workspaces/:workspaceId/saved-views`
- `PATCH /api/v1/customer/workspaces/:workspaceId/saved-views/:viewId`
- `POST /api/v1/customer/workspaces/:workspaceId/saved-views/:viewId/duplicate`
- `DELETE /api/v1/customer/workspaces/:workspaceId/saved-views/:viewId`

All read and write queries include both `workspace_id` and `user_id`. Owners, admins, and viewers can manage only their own views. A partial unique index allows no more than one default view per user in each workspace.

The stored configuration contains the relative or custom date window, owner, country, lead source, pipeline, stage, dashboard section, and an optional validated widget-configuration object. Relative dates are resolved when a view is opened, so a “This month” view remains current.

## Migration and rollback

Migration `2_saved_reporting_views` runs only after the customer identity tables exist. The migration is transactional and exposes an explicit rollback through `getMigrationRollbackSql(2)`:

```sql
DROP TABLE IF EXISTS saved_reporting_views;
```

Rollback deletes saved view configurations only. It does not modify CRM records, workspaces, users, or HubSpot data.
