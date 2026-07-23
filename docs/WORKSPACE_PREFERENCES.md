# Workspace preferences

Each customer workspace can configure its own identity and regional formatting without affecting another tenant.

## Supported preferences

- Company display name
- Credential-free HTTPS logo URL
- ISO 4217 currency code
- IANA timezone
- BCP-style locale
- System, light, or dark appearance preference
- Six-digit hexadecimal accent color

The customer UI is available at `/settings/preferences`.

## Authorization

All API routes require a signed-in customer session and verified workspace membership. Viewers may read preferences. Owners and admins may update them. The server enforces write roles independently of the browser.

## Storage

Preferences are stored in `workspace_preferences`, keyed by `workspace_id` with `ON DELETE CASCADE`. The schema is created idempotently when the customer route module initializes. Existing workspaces receive safe defaults through the read serializer until their first update.

## Auditability

Every update writes `workspace.preferences_updated` to the workspace audit trail. Metadata records formatting and appearance choices but never stores credentials or private CRM data.

## Logo security

The first release accepts only credential-free HTTPS URLs. Direct binary uploads are intentionally deferred until object storage, malware scanning, MIME validation, size limits, and lifecycle deletion are available.

## Applying preferences

The settings page immediately previews locale, timezone, currency and accent choices. Downstream dashboard, export and scheduled-report renderers can consume the same workspace-scoped API without accepting client-supplied formatting values as authorization.
