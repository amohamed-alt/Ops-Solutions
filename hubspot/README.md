# Ops Solutions HubSpot App

This directory contains the HubSpot Developer Platform project for the Ops Solutions OAuth app.

## Configuration

- Platform version: `2026.03`
- Distribution: Marketplace OAuth for customer self-service installation
- Production redirect URL: `https://ops.dashboardtalentera.tech/api/v1/hubspot/oauth/callback`
- Required access: OAuth, contacts, companies, deals, owners, and their schemas
- Optional access: custom-object schemas for Enterprise accounts
- Calls, meetings, and tasks remain part of CRM synchronization without adding the unsupported `crm.objects.*.read` activity scopes rejected by HubSpot project deployment
- All access is read-only

## Upload to HubSpot

Install or update the HubSpot CLI, authenticate a HubSpot account with developer access, then upload the project:

```bash
npm install -g @hubspot/cli@latest
hs account auth
cd hubspot
hs project upload
```

After the build deploys successfully:

1. Open the project in HubSpot.
2. Open the top-level app component.
3. On the Auth tab, copy the Client ID and Client secret.
4. Store them only in `/root/Ops-Solutions/.env` as `HUBSPOT_CLIENT_ID` and `HUBSPOT_CLIENT_SECRET`.
5. Open the Distribution tab, begin publishing, and complete HubSpot's Marketplace requirements and review.
6. Use the generated install URL to connect test and production customer accounts.

Marketplace OAuth apps do not use a per-account allowlist. HubSpot currently permits up to 25 standard-account installs before listing and unlimited installs after the app is approved and listed. Changing this file prepares the app for public distribution, but does not bypass HubSpot's review process.

Never commit the Client secret, personal access key, OAuth access token, or refresh token to Git.
