# Ops Solutions

Intelligent HubSpot analytics platform designed to adapt to each customer's CRM properties, pipelines and business definitions.

## Current milestone

The platform foundation now includes:

- Next.js web application and setup center
- Fastify API with administrative bootstrap protection
- PostgreSQL tenant workspaces and automatic migrations
- Encrypted HubSpot OAuth access and refresh tokens
- Portal discovery for properties, owners, pipelines and stages
- Optional custom object schema discovery
- Deterministic semantic mapping suggestions for Rank, Tier, Lead Quality and other business fields
- Mapping approval and value normalization
- BullMQ background worker foundation
- Redis
- Docker Compose health checks
- Automated Hostinger VPS deployment through GitHub Actions

The next milestone is the CRM record sync and reusable dashboard metrics engine.

## Repository structure

```text
apps/
  api/       Fastify API, OAuth, discovery and semantic mapping
  web/       Next.js application and setup center
  worker/    BullMQ HubSpot synchronization worker

docs/
  HUBSPOT_SETUP.md

docker-compose.yml
docker-compose.prod.yml
.github/workflows/ci.yml
.github/workflows/deploy.yml
```

## Local production-style startup

1. Copy the environment template:

```bash
cp .env.example .env
```

2. Replace every placeholder secret in `.env`.

3. Start the stack:

```bash
docker compose -f docker-compose.prod.yml up -d --build --wait
```

4. Verify services:

```bash
docker compose -f docker-compose.prod.yml ps
curl http://127.0.0.1:3210/api/health
curl http://127.0.0.1:3211/health
curl http://127.0.0.1:3211/api/v1/platform
```

## HubSpot onboarding workflow

The bootstrap workflow is intentionally API-first until end-user authentication is added:

1. Create a workspace using `x-admin-key`.
2. Request the workspace OAuth authorization URL.
3. Authorize the app as a HubSpot Super Admin.
4. Run portal discovery.
5. Review and approve semantic property mappings.

Full commands and required scopes are documented in [`docs/HUBSPOT_SETUP.md`](docs/HUBSPOT_SETUP.md).

## Production deployment

Every push to `main` triggers `.github/workflows/deploy.yml`.

Required GitHub Actions secrets:

- `VPS_HOST`
- `VPS_PORT`
- `VPS_USER`
- `VPS_SSH_KEY_B64` (recommended)
- `VPS_DEPLOY_PATH`

`VPS_SSH_KEY` remains supported as a fallback, but the Base64 secret avoids multiline formatting issues.

The workflow uploads the repository with `rsync`, preserves the server `.env`, builds the containers and waits for all health checks.

## Security rules

- Never commit `.env`, OAuth tokens, API keys or private SSH keys.
- `ADMIN_API_KEY` is a temporary bootstrap control and must be replaced by user authentication before public onboarding.
- OAuth tokens are encrypted with AES-256-GCM before database storage.
- OAuth state values are stored as SHA-256 hashes, expire after ten minutes and are single-use.
- The bootstrap database credentials are only fallbacks to make an empty development stack start. Replace them before connecting real customer data.
- PostgreSQL and Redis are not exposed publicly.
- The web and API ports are bound to `127.0.0.1` and should be published through the existing reverse proxy.
- The first commercial release remains read-only against HubSpot.

## Next modules

1. End-user authentication and role-based tenant access
2. Initial and incremental CRM record sync
3. Webhook reconciliation
4. Metric and virtual-property engine
5. SDR dashboard template
6. Drill-down and data health
7. AI explanations over deterministic metric aggregates
