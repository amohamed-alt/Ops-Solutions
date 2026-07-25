# Readiness dead-letter incident navigation

## Purpose

The customer readiness center now presents each exhausted notification delivery with the safe, tenant-scoped context of its durable readiness incident. Operators can assess impact before retrying and jump directly to the matching incident card without searching the inbox manually.

## User experience

Each failed delivery can show:

- incident lifecycle status and severity;
- blocker and warning counts;
- readiness score;
- recurrence count;
- a direct **Open incident** action.

The action scrolls to the correlated incident, moves keyboard focus to it, and temporarily highlights the card. Reduced-motion preferences are respected. When a historical incident is unavailable, the UI shows a non-blocking explanation and preserves the delivery retry controls.

## Security and isolation

The UI consumes only the bounded incident summary returned by the tenant-scoped dead-letter API. It does not request or render recipients, message bodies, provider message identifiers, credentials, OAuth data, CRM payloads, session data, IP information, incident notes from the delivery correlation payload, or actor identifiers.

The API correlation remains constrained by both `incident_id` and `workspace_id`. The client never attempts to correlate records independently across workspaces.

## Retry safety

The existing two-step flow is unchanged:

1. **Validate retry** performs the server-side dry run.
2. **Schedule one retry** appears only after successful validation.

Changing workspaces, refreshing the readiness center, or applying a retry clears client-side validation state.

## Validation

Regression coverage verifies:

- incident context serialization is represented in the customer UI;
- direct navigation and focus behavior exist;
- missing historical incidents degrade safely;
- reduced-motion styling is present;
- secret-bearing fields remain excluded;
- bounded list and owner/admin retry controls remain intact.
