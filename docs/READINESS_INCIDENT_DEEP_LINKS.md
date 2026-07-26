# Readiness incident deep links

The customer Readiness Center supports a shareable incident query parameter:

```text
/settings/readiness?incident=<incident-uuid>
```

## Behavior

- Incident IDs are validated as UUIDs in the browser before any request is sent.
- The incident is resolved through the authenticated, tenant-scoped customer proxy.
- If the incident is outside the loaded cursor page or hidden by filters, the detail endpoint loads only that incident.
- The card is inserted without duplication, focused, and scrolled into view while respecting reduced-motion preferences.
- Refreshing the page restores the same incident.
- Browser back/forward navigation updates the selected incident.
- Switching company workspaces clears the incident parameter so an incident from one tenant is never carried into another tenant context.
- Invalid, missing, or cross-tenant incident IDs receive bounded errors and do not expose whether another workspace owns the incident.

## Security properties

- The browser never calls the internal admin API directly.
- Workspace membership is revalidated by the existing Next.js customer proxy.
- Incident lookup remains scoped by `workspace_id + incident_id` in the API.
- Opaque cursor values, credentials, OAuth tokens, CRM payloads, recipients, and delivery bodies are not written into the deep link.

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

Revert the deep-link commit. Existing readiness list, detail, cursor pagination, and dead-letter navigation APIs remain backward compatible and require no database rollback.
