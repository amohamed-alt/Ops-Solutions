# Readiness Incident Cursor Inbox

The customer readiness inbox now consumes the tenant-scoped server-side incident query API directly.

## Behavior

- Filters and sorting execute in PostgreSQL.
- The browser requests 10 incidents per page.
- Additional records are retrieved with the opaque `nextCursor` returned by the API.
- Cursor values remain bound to the original workspace filters and sort order.
- Changing company, status, severity, minimum blockers, or sort aborts the previous request and replaces the result set.
- `Load more incidents` appends the next bounded page without reloading readiness, history, or dead-letter data.
- Filter values remain persisted in the URL. Legacy `incidentPage` is removed because the API cursor is the source of pagination state.

## Safety guarantees

- The browser only calls the authenticated customer proxy.
- The proxy validates workspace membership before forwarding the request.
- Page size is fixed at 10 in the UI and bounded to 50 by the proxy and API.
- The API cursor is opaque and validated against the selected filters.
- Requests are cancelled when the workspace or filters change, preventing stale tenant data from replacing the current selection.
- No OAuth tokens, CRM payloads, session identifiers, provider credentials, recipient details, or database credentials are rendered.

## Validation

Run the platform validation suite:

```bash
bash scripts/validate-platform.sh
```

The web regression test verifies that the UI no longer performs client-side incident filtering or offset pagination and that it consumes `pageInfo.nextCursor`.

## Rollback

Revert the feature commit. The server-side pagination API remains backward compatible with callers that send only a bounded `limit`.
