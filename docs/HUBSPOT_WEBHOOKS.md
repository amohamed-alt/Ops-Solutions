# HubSpot webhook ingestion

Ops Solutions exposes a production webhook receiver at:

```text
POST https://ops.dashboardtalentera.tech/api/v1/hubspot/webhooks
```

The receiver is app-level and resolves every event to an isolated workspace through the connected HubSpot portal ID.

## Security boundary

The endpoint validates `X-HubSpot-Signature-v3` with the existing `HUBSPOT_CLIENT_SECRET` and rejects timestamps outside a five-minute window. Validation uses the external application URL, HTTP method, normalized request URI, serialized request body, and `X-HubSpot-Request-Timestamp`, then compares the Base64 HMAC-SHA256 result in constant time.

No workspace ID, customer session, admin key, OAuth token, or database credential is accepted from the webhook body.

## Event processing

Each event is normalized and persisted in `hubspot_webhook_events` with a unique event key. HubSpot retries and duplicate deliveries therefore do not create duplicate work.

Supported object prefixes:

- contact / contacts
- company / companies
- deal / deals
- call / calls
- meeting / meetings
- task / tasks

Processing behavior:

- creation and property changes queue a deduplicated incremental sync;
- deletion events immediately mark an existing mirrored record as archived and remove its local associations, then queue reconciliation;
- association-change events queue a full reconciliation because the current incremental search does not return complete association changes;
- events for unknown or disconnected portals are journaled as ignored and do not trigger work;
- one sync job is queued per workspace and 30-second delivery bucket.

HubSpot can deliver up to 100 events per request. The endpoint accepts no more than 100 events and returns `204` after durable journaling and queueing.

## HubSpot application configuration

Configure the app-level target URL in the HubSpot developer application and enable only subscriptions required by the product. Start with creation, deletion, and the business properties used by dashboards for contacts, companies, and deals. Add activity subscriptions only where the HubSpot application type supports them.

Webhook configuration is an external HubSpot developer-account action and is intentionally not derived from production secrets or performed by CI.

The application already requests read scopes for contacts, companies, deals, and owners. Any additional subscription requiring another scope must be reviewed before changing OAuth scopes for existing customers.

HubSpot webhook setting changes may take several minutes to propagate. HubSpot retries failed deliveries, so do not return a success response before the event is durably stored.

## Monitoring

The Workspace Operations console displays:

- events received during the last 24 hours;
- failed events during the last 24 hours;
- latest delivery time;
- latest processing status.

The workspace health indicator becomes degraded when failed webhook events exist in the last 24 hours.

## Recovery

1. Correct the receiver, database, or Redis issue.
2. Use the Workspace Operations console to run an incremental sync for ordinary changes.
3. Use full reconciliation for missed deletions or association changes.
4. Review `hubspot_webhook_events` rows with `status = 'failed'` before marking an incident resolved.

Scheduled incremental and periodic full synchronization remain enabled as a safety net. Webhooks improve freshness but do not replace reconciliation.

## Rollback

The feature can be disabled in the HubSpot application without removing data. The journal is additive and contains no OAuth secrets.

Schema rollback:

```sql
DROP TABLE IF EXISTS hubspot_webhook_events;
```

Remove the HubSpot target URL or pause its subscriptions before dropping the table.
