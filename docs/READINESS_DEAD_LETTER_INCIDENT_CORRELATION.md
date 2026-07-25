# Readiness dead-letter incident correlation

## Purpose

Failed readiness regression and recovery notifications are operational symptoms of a durable readiness incident. The dead-letter API now returns a bounded, tenant-scoped incident summary with every exhausted delivery so operators can assess business impact before scheduling a retry.

## API behavior

`GET /api/v1/workspaces/:workspaceId/readiness-delivery-dead-letters`

Each delivery may include an `incident` object with:

- incident ID
- lifecycle status and severity
- occurrence count
- readiness score
- blocker and warning counts
- first and last detection timestamps
- acknowledgement and resolution timestamps

The object is `null` when the historical incident row is unavailable. Delivery listing remains functional in that case.

## Tenant isolation

The delivery query is scoped by the authorized workspace. The incident join requires both:

- `incident.id = delivery.incident_id`
- `incident.workspace_id = delivery.workspace_id`

This prevents a malformed or corrupted foreign identifier from correlating an incident from another workspace.

## Data minimization

The response does not expose:

- recipients
- email bodies
- provider message identifiers
- provider credentials
- OAuth tokens
- CRM payloads
- session or IP data
- incident notes or actor identifiers

Only operational fields required to triage the failed delivery are serialized.

## Retry safety

Correlation does not change retry semantics. Requeue remains a two-step operation:

1. dry-run validation
2. explicit apply for one delivery

The database row lock, workspace-and-delivery match, exhausted-attempt requirement, and no-bulk-requeue policy remain unchanged.

## Operational use

Before requeueing, confirm:

1. the incident is still open or acknowledged;
2. the workspace remains blocked for the same operational reason;
3. the email provider or configuration issue has been corrected;
4. the retry is appropriate for the notification kind.

Resolved incidents may still have an old dead letter. Operators should review whether a recovery message remains useful before scheduling a retry.
