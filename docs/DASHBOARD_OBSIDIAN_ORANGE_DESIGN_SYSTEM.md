# Obsidian Orange dashboard design system

## Purpose

The production dashboard keeps the existing multi-company, workspace-isolated application shell while adopting the denser command-center hierarchy proven in the SDR dashboard. The visual direction uses white working surfaces, an obsidian navigation rail and orange as the single primary action and chart accent.

## Production behavior

- The theme is scoped under `.dashboard-workspace-experience`; setup, authentication and settings screens are not affected.
- It loads after the existing layout and SaaS refresh styles so no component contract or API behavior changes.
- The sidebar uses a high-contrast black treatment with orange active states.
- The dashboard heading is reduced from a marketing-style hero to a compact operational summary.
- KPI cards are shorter, use a consistent orange accent rail and surface decision metrics sooner.
- The attention panel uses a dark high-signal treatment distinct from standard analytics panels.
- Recharts plot areas, grids, labels and tooltips share one consistent presentation layer.
- Filters, tables and panels retain their current behavior, workspace isolation and drill-down routes.

## Accessibility

- Orange is not used as the only status signal; text and layout hierarchy remain present.
- Keyboard focus receives a visible outline.
- The theme includes a `prefers-reduced-motion` mode.
- Responsive overrides preserve usable KPI and heading dimensions on narrow screens.

## Security and privacy

The stylesheet contains no external URLs, remote fonts, inline data payloads, credentials, tenant data, CRM values or analytics tracking. It changes presentation only.

## Validation

Run the dashboard visual regression guard:

```bash
node apps/web/test/dashboard-obsidian-orange-theme.test.js
```

Then run the standard web and platform validation gates.

## Rollback

Remove the final import from `apps/web/app/dashboard/page.js` or revert the change. There are no database migrations, environment variables, dependencies, background jobs or API changes to roll back.
