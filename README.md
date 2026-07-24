# Ops Solutions

Production multi-tenant HubSpot analytics SaaS that discovers each customer's CRM structure, synchronizes tenant-isolated data and produces operational dashboards, exports, retention intelligence and alerts.

## Current production capabilities

### Customer platform

- Next.js customer application with self-service onboarding
- Fastify API and BullMQ synchronization worker
- PostgreSQL workspaces, memberships, invitations, RBAC and audit logs
- Secure authentication, persistent sessions, password recovery and Account Security Center
- New-device detection and privacy-safe security alerts
- Encrypted HubSpot OAuth tokens and portal onboarding
- Property, owner, pipeline, stage and custom-object schema discovery
- Deterministic semantic mappings for Rank, Tier, Lead Quality, outcomes, products and renewal fields
- Initial, incremental and webhook-targeted CRM synchronization

### Dashboards and reporting

- Executive, Sales Manager, SDR and RevOps dashboard modes
- Progressive report loading, bounded caching and sync-driven cache invalidation
- Revenue, pipeline, activity, source, market, owner and data-quality reports
- Object dashboards for Contacts, Companies, Deals, Calls, Meetings, Tasks and Tickets
- Dynamic reporting for Leads, Products, Line Items, Quotes, Email engagements and discovered custom objects
- Tenant-scoped server search, pagination and bounded CSV exports
- Drill-downs with direct HubSpot record links
- Saved views and scheduled CSV/XLSX email reports
- Filtered executive PDF snapshots

### Retention and commercial operations

- Retention Budget CSV template, validation and explicit column mapping
- Company + Product + Budget Month deduplication
- HubSpot company and deal matching
- Upcoming, Delayed, Renewed Late, Lost / Expected Lost and Not in Budget classifications
- Renewal Value, Booked, Cash Collected and Remaining Collection reporting
- Pilot, Growth, Scale and Managed plan catalog
- Trial, plan-change, cancellation and reactivation lifecycle
- Usage and entitlement tracking for seats, records, exports and schedules
- Operational alert policies with thresholds, cooldowns, recovery notifications and durable delivery history

### Production operations

- Ubuntu VPS and Docker Compose deployment
- GitHub Actions validation, security scanning and automatic deployment
- Runtime configuration drift gate and verified PostgreSQL backup
- Automatic application rollback after failed deployment verification
- Backup freshness, data-SLA and tenant-integrity monitoring
- PostgreSQL and Redis are private to the application network

## Main routes

- `/dashboard` — role-based revenue command center
- `/dashboard/all-objects` — dynamic standard/custom CRM object catalog
- `/dashboard/objects/{contacts|companies|deals|calls|meetings|tasks|tickets}`
- `/dashboard/retention-budget` — approved budget import and retention reporting
- `/settings/reports` — scheduled report delivery
- `/settings/alerts` — operational threshold alerts
- `/settings/billing` — plans, trials, usage and subscription lifecycle
- `/settings/security` — customer sessions and account security

The detailed report inventory is documented in [`docs/DASHBOARD_CATALOG.md`](docs/DASHBOARD_CATALOG.md).

## Repository structure

```text
apps/
  api/       Fastify API, auth, HubSpot, reporting, retention, billing and alerts
  web/       Next.js onboarding, dashboards, security and settings
  worker/    BullMQ HubSpot synchronization and report-cache invalidation

docs/       Setup, reporting, security and operations runbooks
scripts/     Deployment, backup, monitoring, rollback and audit tooling
```

## Local production-style startup

```bash
cp .env.example .env
docker compose -f docker-compose.prod.yml up -d --build --wait
docker compose -f docker-compose.prod.yml ps
curl http://127.0.0.1:3210/api/health
curl http://127.0.0.1:3211/health
```

Use development-only placeholder credentials locally. Never copy production values into source control or documentation.

## Production deployment

Every merge to `main` triggers `.github/workflows/deploy.yml`.

The deployment pipeline:

1. validates API, worker, web, HubSpot project, scripts and Docker Compose;
2. scans tracked files and production dependencies;
3. audits runtime configuration without printing values;
4. creates and verifies a PostgreSQL backup for established deployments;
5. preserves `/root/Ops-Solutions/.env` while uploading the candidate release;
6. builds and verifies the Docker Compose stack;
7. automatically restores the prior application release when candidate verification fails.

## Security boundaries

- Production secrets remain only in `/root/Ops-Solutions/.env`.
- OAuth tokens are encrypted with AES-256-GCM.
- Password-reset and OAuth-state credentials are high entropy, hashed, expiring and single-use.
- Customer mutations use same-origin and Fetch Metadata protections.
- Reporting, exports, imports, billing and alerts are workspace scoped.
- Session and security tooling never exposes cookies, token hashes, raw IPs or CRM payloads.
- The commercial analytics release remains read-only against customer HubSpot records.

## External launch requirements

The application code supports managed/private customers. These launch steps require external accounts or approvals:

- HubSpot Marketplace conversion, listing approval, verified domain and policy/support pages
- A selected live payment provider, products/prices, signed webhooks and production credentials
- Resend or Postmark configuration with a verified sender domain for real email delivery
- A customer-approved Retention Budget CSV imported through the application

Until a payment provider is connected, plans operate in provider-neutral/manual mode and no cards are charged.
