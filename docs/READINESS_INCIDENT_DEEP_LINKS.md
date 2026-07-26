# Readiness incident deep links

The customer Readiness Center supports shareable, workspace-aware incident links:

```text
/settings/readiness?workspace=<workspace-uuid>&incident=<incident-uuid>
```

Each incident card includes a **Copy link** action. Successful copies show visible feedback and announce the result through an accessible live region.

## Behavior

- Workspace and incident IDs are validated as UUIDs in the browser before any detail request is sent.
- The requested workspace is selected only when it exists in the authenticated session membership list.
- Unauthorized, invalid, or stale workspace parameters fall back to an authorized workspace and do not reveal whether another tenant exists.
- The incident is resolved through the authenticated, tenant-scoped customer proxy.
- If the incident is outside the loaded cursor page or hidden by filters, the detail endpoint loads only that incident.
- The card is inserted without duplication, focused, and scrolled into view while respecting reduced-motion preferences.
- Refreshing the page restores the authorized workspace and the same incident.
- Browser back/forward navigation restores workspace and incident state only when the workspace remains authorized.
- Switching company workspaces clears the previous incident parameter so an incident from one tenant is never carried into another tenant context.
- Invalid, missing, or cross-tenant incident IDs receive bounded errors and do not expose whether another workspace owns the incident.

## Clipboard compatibility

The UI prefers `navigator.clipboard.writeText` in secure browser contexts. A temporary, non-visible textarea fallback supports older browsers where the modern Clipboard API is unavailable. The fallback is removed immediately after the copy attempt and never stores the link outside the browser clipboard.

Copy feedback automatically clears after three seconds and its timer is cleaned up when the page unmounts.

## Security properties

- The browser never calls the internal admin API directly.
- Workspace selection is constrained to memberships returned by `/api/customer/auth/session`.
- Workspace membership is revalidated by the existing Next.js customer proxy.
- Incident lookup remains scoped by `workspace_id + incident_id` in the API.
- Opaque cursor values, credentials, OAuth tokens, CRM payloads, recipients, and delivery bodies are not written into the deep link.
- The workspace UUID is an identifier, not an authorization mechanism; server-side membership remains mandatory on every request.

## Validation

Run the web regression suite and production build:

```bash
npm --prefix apps/web test
npm --prefix apps/web run build
```

The focused regression test is:

```bash
node apps/web/test/readiness-incident-deep-links.test.js
```

## Rollback

Revert the workspace-aware copy-link commit. Existing readiness list, detail, cursor pagination, and dead-letter navigation APIs remain backward compatible and require no database rollback.