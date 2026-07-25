# Readiness Incident Detail Navigation

## Purpose

The readiness operations inbox uses server-side filters and opaque cursor pagination. A failed notification can reference an incident that is not present in the currently loaded page. The customer web application now resolves that incident through a tenant-scoped detail endpoint instead of requiring operators to clear filters or load every page.

## Request flow

1. The failed-delivery card uses the incident identifier returned by the dead-letter API.
2. The page first checks the incidents already loaded in memory.
3. When the incident is absent, the browser calls:

   `GET /api/customer/workspaces/:workspaceId/readiness-incidents/:incidentId`

4. The Next.js route validates the signed-in user's membership in the requested workspace.
5. The proxy calls the internal API detail endpoint with server-only admin headers.
6. The returned incident is inserted into the visible inbox, highlighted, scrolled into view, and focused for keyboard users.

## Security guarantees

- Workspace membership is checked before the upstream request.
- Both workspace and incident identifiers are URL encoded.
- The API query remains scoped by `workspace_id + incident_id`.
- Responses use `Cache-Control: no-store`.
- The upstream request has a 20-second timeout.
- In-flight detail requests are aborted when the workspace changes or a newer incident is requested.
- No recipients, email bodies, provider message identifiers, OAuth tokens, CRM payloads, session tokens, IP addresses, or credentials are returned to the page.

## UX behavior

- Incidents already loaded are focused immediately.
- Incidents outside the current cursor page are fetched without resetting filters or reloading the readiness report.
- Duplicate incident cards are prevented.
- The active failed-delivery button shows a loading state.
- Smooth scrolling respects `prefers-reduced-motion`.
- A bounded error is shown when the incident no longer exists or belongs to another workspace.

## Validation

Run the standard platform validation, including the dedicated web regression test:

```bash
node --test apps/web/test/readiness-incident-detail-navigation.test.js
bash scripts/validate-platform.sh
```

## Rollback

Revert the pull request. The API detail endpoint can remain available independently; removing the web integration restores the previous behavior where operators must locate the correlated incident manually.
