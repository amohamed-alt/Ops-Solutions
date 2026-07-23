# Workspace Data SLA Console

The customer-facing Data SLA console is available at `/settings/data-sla` and evaluates operational reliability across every workspace in the signed-in account.

## Monitored objectives

- HubSpot OAuth connection remains connected.
- Latest synchronization did not fail.
- CRM mirror freshness is no older than 90 minutes for warning and 24 hours for critical breach.
- No failed webhook events were recorded during the previous 24 hours.
- Semantic mapping suggestions are reviewed before they become a reporting risk.

The console is intentionally read-only. Recovery actions remain in Workspace Operations and the Mapping Wizard, linked from each company card.

## Refresh behavior

The browser refreshes the assessment every 60 seconds while the page is visible and online. Polling pauses in background tabs and during network loss, then resumes after connectivity returns. Every internal request has a bounded timeout.

## Tenant safety

The page first reads the signed customer session and requests each workspace through the existing customer operations proxy. The server proxy verifies membership before accessing internal operations data. Browser-provided workspace identifiers never authorize access.

The downloadable JSON snapshot contains only operational metadata: workspace identifiers and names, portal ID, status grade, SLA breaches, freshness age, record count, failed webhook count, and pending mapping count. It excludes CRM properties, raw webhook payloads, OAuth tokens, database credentials, export artifacts, and user session data.

## Interpretation

- `healthy`: all monitored objectives are met.
- `warning`: freshness exceeded 90 minutes, mapping review is pending, or recoverable webhook issues exist.
- `critical`: HubSpot is disconnected, synchronization failed, no freshness timestamp exists, or CRM data is older than 24 hours.
- `unknown`: the operational endpoint could not be read for that workspace.

This is an operational indicator rather than a contractual availability SLA. Commercial uptime commitments, escalation windows, and customer-facing incident communications remain business decisions.
