# Ops Solutions HubSpot App

This directory contains the HubSpot Developer Platform project for the Ops Solutions OAuth app.

## Configuration

- Platform version: `2026.03`
- Distribution: private OAuth beta
- Production redirect URL: `https://ops.dashboardtalentera.tech/api/v1/hubspot/oauth/callback`
- Required access: contacts, companies, deals, owners, and their schemas
- Optional access: calls, meetings, tasks, and custom-object schemas
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
5. Add the first HubSpot production account to the private OAuth allowlist from the Distribution tab.
6. Use the generated install URL to connect the account.

Never commit the Client secret, personal access key, OAuth access token, or refresh token to Git.
