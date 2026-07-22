# Remaining Product Milestones

## Milestone 1 — Production deployment unblock

- Add `VPS_SSH_KEY_B64` to GitHub Actions secrets.
- Complete the production `.env` on the VPS.
- Deploy the platform stack.
- Connect Traefik and the production domain.
- Verify backups, health checks and container resource use.

## Milestone 2 — End-user access

- Email/password or passwordless authentication.
- Workspace membership and invitations.
- Roles: owner, admin, manager and viewer.
- Tenant-isolation integration tests.
- Session audit log.

## Milestone 3 — HubSpot onboarding

- Create the HubSpot OAuth app.
- Test required and optional scopes on multiple portals.
- Complete portal discovery and mapping approval UX.
- Add connection status, disconnect and reauthorization actions.

## Milestone 4 — CRM freshness

- Deploy the initial and incremental sync engine.
- Add HubSpot webhooks with signature validation.
- Add archived/deleted record reconciliation.
- Add queue health, retry and dead-letter controls.

## Milestone 5 — First sellable dashboard

- Wire the analytics compiler to authenticated API routes.
- Render the Smart SDR Dashboard template.
- Add owner/date/country/pipeline filters.
- Add clickable drill-down lists and Open in HubSpot links.
- Add sync freshness and data-quality indicators.

## Milestone 6 — Smart configuration

- Mapping approval wizard.
- Value-mapping editor for Rank/Tier/Hot-Warm-Cold.
- Custom virtual-property builder.
- AI-assisted mapping when deterministic confidence is low.
- Mapping version history and audit log.

## Milestone 7 — Commercial readiness

- Subscription and billing.
- Usage limits by portal and record volume.
- Customer onboarding and support diagnostics.
- Privacy policy, terms and data deletion workflow.
- Encrypted backups and recovery test.
- Beta testing across at least three differently configured HubSpot portals.
