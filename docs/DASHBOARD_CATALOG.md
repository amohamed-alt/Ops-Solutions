# Dashboard and report catalog

This document is the production source of truth for the customer-facing reporting surface.

## Stable routes

| Route | Purpose |
| --- | --- |
| `/dashboard` | Role-based revenue command center |
| `/dashboard/executive` | Executive overview alias |
| `/dashboard/pipeline` | Pipeline and revenue alias |
| `/dashboard/activities` | Activity performance alias |
| `/dashboard/sources` | Source and market performance alias |
| `/dashboard/team` | Team performance alias |
| `/dashboard/retention` | Retention reporting alias |
| `/dashboard/revops` | Data quality and RevOps alias |
| `/dashboard/objects/contacts` | Contact intelligence |
| `/dashboard/objects/companies` | Company intelligence |
| `/dashboard/objects/deals` | Deal intelligence |
| `/dashboard/objects/calls` | Call intelligence |
| `/dashboard/objects/meetings` | Meeting intelligence |
| `/dashboard/objects/tasks` | Task intelligence |
| `/dashboard/objects/tickets` | Ticket intelligence |

## Shared behavior

All customer dashboards:

- require an authenticated workspace membership;
- scope every query by workspace ID;
- use synchronized HubSpot records rather than browser-held CRM credentials;
- support bounded date ranges and cancellation of stale requests;
- expose drill-down records with pagination;
- link every supported standard record back to HubSpot;
- avoid blocking the core command center while advanced reports compile;
- preserve CSV export for operational analysis.

## Executive and operating reports

The revenue command center includes:

- portfolio contacts and new contacts;
- calls, connected calls and connection rate;
- meetings booked, completed and no-show metrics;
- open deals, open pipeline, won deals and won revenue;
- closing-soon pipeline and revenue risk;
- overdue tasks, due-today tasks and records without a next activity;
- lead source and country performance;
- owner performance;
- Rank/Tier or Lead Quality funnel when an approved semantic mapping exists;
- commercial milestones and retention readiness;
- data quality, mapping health and synchronization health.

Missing customer-specific semantic mappings return an explicit configuration-required state instead of guessing a property.

## Object intelligence

### Contacts

- missing email;
- missing phone and mobile;
- untouched contacts;
- stale contacts;
- customer lifecycle contacts;
- contacts associated with deals;
- contacts missing a company association;
- lifecycle-stage distribution;
- lead-source distribution;
- creation trend.

### Companies

- missing domain;
- missing industry;
- active accounts;
- churned accounts;
- companies with deals;
- companies without deals;
- industry distribution;
- account-status distribution;
- creation trend.

### Deals

- open deals;
- won deals;
- lost deals;
- overdue close dates;
- deals without a next activity;
- open pipeline amount;
- won revenue;
- deals missing contact associations;
- deals missing company associations;
- stage distribution;
- pipeline distribution;
- creation trend.

### Calls

- calls with dispositions;
- calls missing dispositions;
- completed calls;
- calls missing contact associations;
- disposition distribution;
- status distribution;
- creation trend.

### Meetings

- completed meetings;
- no-show meetings;
- meetings missing outcomes;
- meetings missing notes;
- meetings missing contact associations;
- outcome distribution;
- meeting-type distribution;
- creation trend.

### Tasks

- open tasks;
- completed tasks;
- tasks due today;
- overdue tasks;
- high-priority tasks;
- tasks missing contact associations;
- status distribution;
- priority distribution;
- creation trend.

### Tickets

- open tickets;
- closed tickets;
- high-priority tickets;
- tickets missing priority;
- tickets missing contact associations;
- pipeline-stage distribution;
- priority distribution;
- creation trend.

## Retention source of truth

The platform supports HubSpot-derived retention readiness. Final Budget-vs-Actual reporting requires a customer-approved external budget source with stable columns for company, product, budget month, renewal value, booked value, collected value, RM/CSM and loss status.

The integration must not infer or silently invent budget values. Until a source is configured, the UI must label HubSpot-derived metrics as fallback/readiness metrics.

## Future object packs

Leads, products, line items, quotes, email engagements and custom objects must only be enabled after both conditions are true:

1. the workspace synchronization policy includes the object and required associations;
2. the HubSpot application has the required approved scopes for that installation.

Do not display a fake zero-value dashboard for an object that was never authorized or synchronized.
