# Localized and branded scheduled report emails

Scheduled report delivery now renders every message using the selected workspace preferences instead of a global fixed theme.

## Applied workspace preferences

- `company_name` controls the email identity and subject prefix.
- `currency` is displayed as reporting context.
- `timezone` controls the generated timestamp.
- `locale` controls report-period and generated-time formatting.
- `accent_color` controls the callout and action-link color.
- `logo_url` is rendered only when it is a credential-free HTTPS URL.

If a preference is missing or invalid, delivery falls back to:

- Company name: workspace name
- Currency: `USD`
- Timezone: `UTC`
- Locale: `en-US`
- Accent: `#087f68`
- Logo: generated company initials

## Tenant isolation

The delivery claim joins `workspace_preferences` using the same `workspace_id` already shared by the schedule, execution, export job, and workspace. No browser input participates in email rendering. Provider credentials remain in the server environment.

Delivery metadata records the effective locale, timezone, currency, provider, and whether custom branding was applied. It does not store recipient addresses, email HTML, CRM payloads, tokens, or provider credentials.

## Security boundaries

- HTML values are escaped before rendering.
- Logo URLs require HTTPS and reject embedded usernames or passwords.
- Accent colors must be six-digit hexadecimal values.
- Invalid IANA timezones, locales, and currencies fall back safely.
- Attachments retain the existing 5 MiB limit and workspace-scoped export authorization.
- Resend and Postmark idempotency and retry behavior are unchanged.

## Verification

After deployment, create a scheduled report for a test workspace with a non-default timezone, locale, currency, accent color, and HTTPS logo. Verify:

1. The subject uses the workspace company name.
2. The generated timestamp uses the workspace timezone.
3. The reporting period follows the workspace locale.
4. The selected currency is displayed in the reporting context.
5. The email uses the workspace logo and accent color.
6. `scheduled_report_executions.delivery_metadata` contains only the effective formatting context and provider identifier.
