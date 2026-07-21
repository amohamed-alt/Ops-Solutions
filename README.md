# Ops Solutions

Intelligent HubSpot analytics platform designed to adapt to each customer's CRM properties, pipelines and business definitions.

## Current milestone

This repository currently provides the production platform foundation:

- Next.js web application
- Fastify API
- BullMQ background worker
- PostgreSQL
- Redis
- Docker Compose health checks
- Automated Hostinger VPS deployment through GitHub Actions

The next milestone adds HubSpot OAuth, portal discovery and semantic property mapping.

## Repository structure

```text
apps/
  api/       Fastify HTTP API and dependency health checks
  web/       Next.js application
  worker/    BullMQ HubSpot synchronization worker

docker-compose.prod.yml
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
```

## Production deployment

Every push to `main` triggers `.github/workflows/deploy.yml`.

Required GitHub Actions secrets:

- `VPS_HOST`
- `VPS_PORT`
- `VPS_USER`
- `VPS_SSH_KEY`
- `VPS_DEPLOY_PATH`

The workflow uploads the repository with `rsync`, preserves the server `.env`, builds the containers and waits for all health checks.

## Security rules

- Never commit `.env`, OAuth tokens, API keys or private SSH keys.
- The bootstrap database credentials are only fallbacks to make the empty development stack start. Replace them before connecting real customer data.
- PostgreSQL and Redis are not exposed publicly.
- The web and API ports are currently bound to `127.0.0.1` and should be published through the existing reverse proxy.

## Planned modules

1. Authentication and tenant workspaces
2. HubSpot OAuth connection
3. Portal schema discovery
4. Semantic property mapping
5. Initial and incremental CRM sync
6. SDR dashboard template
7. Drill-down and data health
