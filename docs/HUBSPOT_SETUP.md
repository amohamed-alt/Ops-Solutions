# HubSpot OAuth and Portal Discovery Runbook

## 1. Generate production secrets on the VPS

```bash
openssl rand -base64 48   # ADMIN_API_KEY
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -base64 36   # POSTGRES_PASSWORD
```

Store the generated values only in `/root/Ops-Solutions/.env`.

## 2. Create the HubSpot app

Create a public-distribution OAuth app in the HubSpot developer platform.

Set the redirect URL to:

```text
https://YOUR_DOMAIN/api/v1/hubspot/oauth/callback
```

Required scopes:

```text
oauth
crm.objects.contacts.read
crm.objects.companies.read
crm.objects.deals.read
crm.objects.owners.read
crm.schemas.contacts.read
crm.schemas.companies.read
crm.schemas.deals.read
```

Optional scope:

```text
crm.schemas.custom.read
```

The optional custom-schema scope allows Enterprise accounts to expose custom object definitions without preventing installation on accounts that do not have custom objects.

## 3. Configure the server environment

```dotenv
NODE_ENV=production
APP_URL=https://YOUR_DOMAIN
ADMIN_API_KEY=YOUR_GENERATED_ADMIN_API_KEY
ENCRYPTION_KEY=YOUR_GENERATED_32_BYTE_BASE64_KEY

POSTGRES_DB=ops_solutions
POSTGRES_USER=ops_solutions
POSTGRES_PASSWORD=YOUR_GENERATED_DATABASE_PASSWORD
DATABASE_URL=postgresql://ops_solutions:YOUR_GENERATED_DATABASE_PASSWORD@postgres:5432/ops_solutions
REDIS_URL=redis://redis:6379

HUBSPOT_CLIENT_ID=YOUR_HUBSPOT_CLIENT_ID
HUBSPOT_CLIENT_SECRET=YOUR_HUBSPOT_CLIENT_SECRET
HUBSPOT_REDIRECT_URI=https://YOUR_DOMAIN/api/v1/hubspot/oauth/callback
HUBSPOT_SUCCESS_REDIRECT_URI=https://YOUR_DOMAIN/setup
```

Restart after updating the environment:

```bash
cd /root/Ops-Solutions
docker compose -f docker-compose.prod.yml up -d --build --wait
```

## 4. Create the first workspace

The administrative API is bound to localhost and should be called from the VPS until user authentication is implemented.

```bash
export ADMIN_API_KEY='YOUR_GENERATED_ADMIN_API_KEY'

curl --fail-with-body \
  --request POST \
  --url http://127.0.0.1:3211/api/v1/workspaces \
  --header "x-admin-key: $ADMIN_API_KEY" \
  --header 'content-type: application/json' \
  --data '{"name":"First Customer","slug":"first-customer"}'
```

Save the returned workspace `id`.

## 5. Generate the OAuth authorization URL

```bash
export WORKSPACE_ID='WORKSPACE_UUID'

curl --fail-with-body \
  --url "http://127.0.0.1:3211/api/v1/workspaces/$WORKSPACE_ID/hubspot/oauth/start" \
  --header "x-admin-key: $ADMIN_API_KEY"
```

Open the returned `authorizationUrl` in a browser and authorize the app as a HubSpot Super Admin.

HubSpot redirects back to the configured callback. The API validates the single-use state value, exchanges the authorization code, encrypts both tokens and redirects to `/setup`.

## 6. Run portal discovery

```bash
curl --fail-with-body \
  --request POST \
  --url "http://127.0.0.1:3211/api/v1/workspaces/$WORKSPACE_ID/hubspot/discover" \
  --header "x-admin-key: $ADMIN_API_KEY"
```

Discovery reads:

- Contact, company and deal property definitions
- Property dropdown options and metadata
- Owners and teams
- Deal pipelines and stages
- Custom object schemas when available
- Custom object pipelines when available

It then generates semantic mapping suggestions.

## 7. Review suggestions

```bash
curl --fail-with-body \
  --url "http://127.0.0.1:3211/api/v1/workspaces/$WORKSPACE_ID/mapping-suggestions" \
  --header "x-admin-key: $ADMIN_API_KEY"
```

The response ranks up to three candidates per semantic field and object type using:

- Property internal name
- Display label
- Description and group
- Property data type
- Dropdown option patterns such as A/B/C, Tier 1/2/3 and Hot/Warm/Cold

## 8. Approve a mapping

Example: map a contact property called `lead_tier` to the canonical `lead_quality` field.

```bash
curl --fail-with-body \
  --request POST \
  --url "http://127.0.0.1:3211/api/v1/workspaces/$WORKSPACE_ID/mappings/lead_quality/approve" \
  --header "x-admin-key: $ADMIN_API_KEY" \
  --header 'content-type: application/json' \
  --data '{
    "objectType":"contacts",
    "propertyName":"lead_tier"
  }'
```

For common tier values, the platform automatically proposes canonical values:

```text
A / Tier 1 / Hot   -> highest
B / Tier 2 / Warm  -> medium
C / Tier 3 / Cold  -> lowest
```

A custom `valueMapping` object can be supplied in the request body to override this inference.

## 9. Inspect setup status

```bash
curl --fail-with-body \
  --url "http://127.0.0.1:3211/api/v1/workspaces/$WORKSPACE_ID/setup" \
  --header "x-admin-key: $ADMIN_API_KEY"
```

The result includes connection health, property counts, approved mappings, pending suggestions and the latest discovery run.

## Security notes

- Do not expose `ADMIN_API_KEY` to browser JavaScript.
- Do not commit `.env`.
- Keep the product read-only until tenant authentication and audit logging are complete.
- Rotate the HubSpot client secret and encryption key through a controlled migration process; changing the encryption key without re-encrypting stored tokens makes existing connections unreadable.
- The OAuth callback is public by design, but it accepts only valid unexpired single-use state values.

## Official HubSpot references

- OAuth quickstart: https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth/oauth-quickstart-guide
- OAuth token management: https://developers.hubspot.com/docs/api-reference/latest/authentication/manage-oauth-tokens
- Properties API: https://developers.hubspot.com/docs/api-reference/latest/crm/properties/get-properties
- Owners API: https://developers.hubspot.com/docs/api-reference/latest/crm/owners/guide
- Pipelines API: https://developers.hubspot.com/docs/api-reference/latest/crm/pipelines/guide
- Custom object schemas: https://developers.hubspot.com/docs/api-reference/latest/crm/objects/schemas/guide
