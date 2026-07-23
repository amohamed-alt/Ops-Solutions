# Workspace-localized report exports

Revenue CSV exports now resolve formatting from the tenant-owned `workspace_preferences` row.

## Applied preferences

- Currency: ISO 4217 code used by `Intl.NumberFormat` for pipeline and revenue values.
- Timezone: IANA timezone used for generated-at and data-freshness timestamps.
- Locale: BCP 47 locale used for currency and date formatting.

Missing or invalid persisted values fall back to `USD`, `UTC`, and `en-US`. The export includes the effective currency, timezone, and locale in its metadata so recipients can interpret values consistently.

## Security and isolation

Preference lookup is parameterized and scoped by `workspace_id`. Export authorization remains unchanged: customer exports require a verified workspace membership, and administrative exports require the existing admin boundary. No credentials, HubSpot tokens, raw CRM payloads, or internal database identifiers are added to generated files.

## Compatibility

- CSV injection neutralization remains active.
- UTF-8 BOM remains present for Excel and Arabic text compatibility.
- Existing filters, rate limits, file-size limits, audit events, and filenames remain compatible.
- Counts and percentages remain machine-readable numbers; only monetary values and timestamps are localized.

## Verification

Run `npm test` in `apps/api`. Tests cover tenant-scoped preference loading, safe fallback behavior, locale/timezone formatting, and localized CSV metadata and financial sections.
