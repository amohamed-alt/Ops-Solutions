# Customer Onboarding Readiness Center

The customer-facing readiness center at `/settings/readiness` now consumes the canonical server-side onboarding readiness evaluator instead of reconstructing core readiness in the browser.

## Source of truth

The web application proxies the following tenant-scoped operations after validating the signed-in customer's workspace membership:

- `GET /api/customer/workspaces/:workspaceId/onboarding-readiness` — live, read-only evaluation.
- `POST /api/customer/workspaces/:workspaceId/onboarding-readiness` — owner/admin-only evaluation with an immutable snapshot.
- `GET /api/customer/workspaces/:workspaceId/onboarding-readiness/history` — immutable snapshot history.

The internal admin key is added only on the server-side proxy and is never returned to the browser.

## Readiness checks

The canonical evaluator covers:

1. Workspace lifecycle status.
2. HubSpot OAuth connection.
3. Contacts, companies, and deals schema discovery.
4. Approved semantic mappings.
5. Initial CRM synchronization.
6. CRM mirror freshness SLA.
7. Active workspace ownership.
8. Workspace audit trail.

The UI renders the server-provided score, blockers, warnings, evidence summaries, and next actions. It links each actionable check to the relevant onboarding, mapping, team, audit, or data-health surface.

## Durable history

Owners and admins can record the current evaluation. Each snapshot stores the score and readiness state and identifies transitions from blocked to ready or ready to blocked. Viewers can inspect live status and existing history but cannot create snapshots.

History responses are bounded, tenant-scoped, and returned with `Cache-Control: no-store`.

## Operational behavior

- Requests are cancelled when the selected workspace changes or the page unmounts.
- Each loading cycle has a 12-second browser timeout.
- API proxies have a 20-second upstream timeout.
- No OAuth tokens, CRM values, session hashes, database credentials, or admin credentials are exposed.
- A failed readiness service returns a sanitized `503` response.
