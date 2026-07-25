# Readiness delivery dead-letter admin API

## Purpose

This API exposes tenant-scoped operational controls for readiness notification deliveries that exhausted all retry attempts. It is intended for the customer admin surface and internal operational tooling.

## Endpoints

### List dead letters

```http
GET /api/v1/workspaces/:workspaceId/readiness-delivery-dead-letters?limit=50
```

The response is bounded to 200 rows and includes only operational metadata: delivery ID, incident ID, snapshot ID, kind, attempts, a shortened error, and timestamps.

### Preview requeue

```http
POST /api/v1/workspaces/:workspaceId/readiness-delivery-dead-letters/:deliveryId/requeue
Content-Type: application/json

{"apply":false}
```

Preview is the default. It locks and validates the delivery but does not change its state.

### Apply requeue

```http
POST /api/v1/workspaces/:workspaceId/readiness-delivery-dead-letters/:deliveryId/requeue
Content-Type: application/json

{"apply":true}
```

Only deliveries in `failed` state with at least five attempts are eligible. The underlying operation resets the delivery to `pending`, clears stale provider claim metadata, and schedules an immediate retry.

## Security model

- Every route requires admin authentication.
- The requested workspace is resolved through the existing authorized workspace boundary before data access.
- Every requeue operation matches both `workspace_id` and `delivery_id`.
- Preview is the default and explicit `apply: true` is required for mutation.
- Responses exclude recipients, message bodies, provider message IDs, credentials, OAuth tokens, CRM payloads, sessions, and IP data.
- List size is bounded to prevent unbounded responses.

## Operational responses

- `200`: applied requeue or successful list.
- `202`: eligible dry-run preview.
- `404`: delivery does not exist inside the authorized workspace.
- `409`: delivery exists but is not an exhausted failed delivery.

## Rollback

Remove `registerReadinessDeadLetterRoutes` and its registration from `apps/api/src/sync-operations.js`. No database migration or destructive rollback is required because this change only exposes the existing durable dead-letter engine through authenticated routes.
