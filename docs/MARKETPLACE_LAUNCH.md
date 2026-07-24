# HubSpot Marketplace Launch Runbook

## Public URLs

- Application: `https://ops.dashboardtalentera.tech`
- Privacy: `https://ops.dashboardtalentera.tech/privacy`
- Terms: `https://ops.dashboardtalentera.tech/terms`
- Security: `https://ops.dashboardtalentera.tech/security`
- Support: `https://ops.dashboardtalentera.tech/support`
- Data deletion: `https://ops.dashboardtalentera.tech/data-deletion`

## Code-complete readiness

- Marketplace distribution is declared in the HubSpot project.
- OAuth uses the production callback and read-only CRM scopes.
- Customer onboarding, discovery, synchronization and role-based dashboards are production implemented.
- Public legal, support, security and deletion pages are available without authentication.
- Robots policy blocks authenticated customer routes and allows public policy pages.
- Sitemap advertises the public policy and support routes.
- Data deletion instructions distinguish HubSpot authorization removal from deletion of synchronized historical data.
- The production integration remains read-only against HubSpot records.

## External account actions

These actions cannot be completed from repository code:

1. Verify control of `dashboardtalentera.tech` in the HubSpot developer account.
2. Complete company identity, logo, category, pricing and listing copy.
3. Submit the application for HubSpot Marketplace review.
4. Complete reviewer test-account and onboarding instructions.
5. Confirm the public support, privacy, terms and deletion URLs in the listing.
6. Respond to reviewer questions and publish after approval.

## Reviewer test flow

1. Create a customer account.
2. Create or select a workspace.
3. Connect a HubSpot test portal through OAuth.
4. Review discovered properties, owners, pipelines and mapping suggestions.
5. Start synchronization and open the dashboard when durable records exist.
6. Verify Executive, Object, Retention, RevOps, export, scheduling and alert experiences.
7. Disconnect the portal and confirm authorization is no longer used.

## Security statement

Never place production credentials in reviewer notes, source control or screenshots. Use a dedicated test portal and test customer account. Production secrets remain only in `/root/Ops-Solutions/.env`.

## Launch acceptance

- All pull-request checks are green.
- Public policy URLs return HTTP 200 without authentication.
- OAuth callback and required scopes pass HubSpot project validation.
- A reviewer can complete onboarding without operator database changes.
- Support and deletion requests reach monitored, domain-verified mailboxes.
- Production email delivery has a verified sender when scheduled delivery or alerts are enabled.
