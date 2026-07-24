# Ops Solutions

Production multi-tenant HubSpot analytics SaaS that discovers each customer's CRM structure, synchronizes tenant-isolated data and generates operational dashboards with drill-down links back to HubSpot.

## Current production capabilities

- Next.js customer application and self-service onboarding
- Fastify API and BullMQ synchronization worker
- PostgreSQL tenant workspaces, memberships, RBAC and audit logs
- Secure customer authentication, persistent sessions and password recovery
- Account security center, session revocation and new-device alerts
- Encrypted HubSpot OAuth access and refresh tokens
- HubSpot portal, property, owner, pipeline, stage and schema discovery
- Deterministic semantic mapping for Rank, Tier, Lead Quality, outcomes and renewal fields
- Initial, incremental and webhook reconciliation sync
- Progressive revenue, SDR, manager, retention-readiness and RevOps reports
- Object dashboards for contacts, companies, deals, calls, meetings, tasks and tickets
- Searchable and paginated drill-downs with direct HubSpot record links
- CSV exports and saved dashboard views
- Production health checks, backup verification, configuration drift gates and automatic application rollback
- GitHub Actions validation, security scanning and Hostinger VPS deployment

## Dashboard routes

- `/dashboard` — role-based revenue command center
- `/dashboard/executive`
- `/dashboard/pipeline`
- `/dashboard/activities`
- `/dashboard/sources`
- `/dashboard/team`
- `/dashboard/retention`
- `/dashboard/revops`
- `/dashboard/objects/contacts`
- `/dashboard/objects/companies`
- `/dashboard/objects/deals`
- `/dashboard/objects/calls`
- `/dashboard/objects/meetings`
- `/dashboard/objects/tasks`
- `/dashboard/objects/tickets`

The full report inventory and definitions are documented in [`docs/DASHBOARD_CATALOG.md`](docs/DASHBOARD_CATALOG.md).

## Repository structure

```text
apps/
  api/       Fastify API, auth, OAuth, discovery, sync operations and reporting
  web/       Next.js onboarding, settings, security center and dashboards
  worker/    BullMQ HubSpot synchronization and reconciliation

docs/        Setup, operations, security and reporting runbooks
scripts/     Deployment, backup, monitoring and recovery tooling

.github/workflows/  CI, security, configuration audit and deployment
docker-compose.yml
docker-compose.prod.yml
```

## Local production-style startup

1. Copy the environment template:

```bash
cp .env.example .env
```

2. Replace every placeholder with local development values. Never copy production credentials into a developer machine.

3. Start the stack:

```bash
docker compose -f docker-compose.prod.yml up -d --build --wait
```

4. Verify the services:

```bash
docker compose -f docker-compose.prod.yml ps
curl http://127.0.0.1:3210/api/health
curl http://127.0.0.1:3211/health
curl http://127.0.0.1:3211/api/v1/platform
```

## Customer onboarding

1. A customer creates or receives an account.
2. An owner creates a company workspace and invites team members.
3. A HubSpot Super Admin connects the portal through OAuth.
4. The platform discovers CRM schemas, properties, owners and pipelines.
5. Deterministic mapping suggestions are reviewed or approved.
6. Historical records synchronize in the background.
7. The dashboard becomes available as soon as durable synchronized data exists; advanced reports continue loading progressively.

Required scopes and HubSpot configuration are documented in [`docs/HUBSPOT_SETUP.md`](docs/HUBSPOT_SETUP.md).

## Production deployment

Every merge to `main` triggers `.github/workflows/deploy.yml`.

The workflow:

1. validates the platform, dependencies and runtime configuration;
2. uploads application files without replacing the server `.env`;
3. creates and verifies a PostgreSQL backup for established installations;
4. builds the Docker Compose release;
5. performs internal and public smoke verification;
6. restores the previous application release automatically if candidate verification fails.

Production secrets remain only in `/root/Ops-Solutions/.env` and must never be printed, copied into CI logs or committed.

## Security boundaries

- OAuth tokens are encrypted with AES-256-GCM before database storage.
- OAuth state and password-reset credentials are hashed, expiring and single-use.
- Customer mutations are protected by same-origin and Fetch Metadata checks.
- PostgreSQL and Redis are not exposed publicly.
- Tenant and account queries are scoped by authenticated workspace or user identity.
- Session and security tooling never exposes raw cookies, token hashes, IP addresses or CRM payloads.
- Production deployment is blocked by critical runtime configuration findings.
- The commercial analytics release remains read-only against customer HubSpot records.

## Commercial launch boundary

The application is ready for managed/private customer pilots. Public self-service distribution still requires external HubSpot Marketplace approval, listing information, verified legal/support pages and any chosen billing provider configuration. Those account-level actions cannot be completed from source code alone.

Retention Budget-vs-Actual reporting additionally requires a customer-approved budget source and stable column mapping. Until configured, the product labels HubSpot-derived retention metrics as readiness/fallback data rather than inventing budget values.
