# Readiness Incident Filtering and Pagination

## Purpose

The customer readiness center now supports operational filtering, deterministic sorting, and pagination for the tenant-scoped readiness incident inbox. The view is designed for workspaces with a long incident history while preserving the existing RBAC and privacy boundaries.

## Controls

The incident inbox supports:

- status: all, active, open, acknowledged, or resolved;
- severity: all, critical, or warning;
- minimum blocker count;
- sorting by latest activity, oldest activity, blocker count, readiness score, or occurrence count;
- ten incidents per page.

The web client requests the API's existing bounded maximum of 200 incidents. Filtering and pagination operate only on that bounded tenant-scoped result set.

## Shareable state

Non-default controls are stored in URL query parameters:

- `incidentStatus`
- `incidentSeverity`
- `minimumBlockers`
- `incidentSort`
- `incidentPage`

Default values are removed from the URL. `history.replaceState` updates the current address without navigation or an additional server request, making filtered operational views refresh-safe and shareable.

## Dead-letter correlation

Opening a correlated incident from a failed delivery clears restrictive filters, returns to latest-activity sorting, calculates the incident page, and then moves keyboard focus to the incident. Reduced-motion preferences are respected.

## Security and isolation

- Workspace access continues to be enforced by the existing customer proxy and API authorization boundary.
- The UI never combines incidents across workspaces.
- The API response remains bounded to 200 rows.
- No notification recipients, email bodies, provider identifiers, credentials, OAuth tokens, CRM payloads, session data, or IP data are introduced.
- Lifecycle mutations remain restricted to workspace owners and admins.

## Validation

`apps/web/test/readiness-incident-filtering.test.js` verifies URL persistence, supported filters and sorting, bounded pagination, correlated incident navigation, responsive controls, and accessibility markers.
