# Customer request security boundary

## Purpose

Ops Solutions authenticates customer browser sessions with an HttpOnly cookie. Every state-changing customer request must therefore prove that it originated from the same application origin. The web proxy enforces this before a request reaches any customer API route.

## Protected surface

The Next.js proxy matches only:

```text
/api/customer/:path*
```

HubSpot OAuth callbacks, HubSpot webhooks, internal API health checks, and server-to-server `/api/v1` traffic are not changed by this boundary.

## Enforcement

For `POST`, `PUT`, `PATCH`, and `DELETE` requests:

1. `Sec-Fetch-Site: cross-site` is rejected.
2. A valid `Origin` header is required.
3. The canonical `Origin` must equal the application request origin.
4. Requests with malformed, credential-bearing, or unsupported origins are rejected.

`GET`, `HEAD`, and `OPTIONS` remain available without an Origin header.

Rejected requests return HTTP 403 with a safe error code and a correlation ID. No session token, cookie, secret, or request body is returned.

## Correlation IDs

The proxy accepts an incoming `X-Request-Id` only when it contains 8-128 safe characters. Otherwise it generates a UUID. The value is forwarded to downstream customer routes and returned in the response.

## Browser security headers

All web responses include:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Cross-Origin-Opener-Policy: same-origin`
- a restrictive `Permissions-Policy`
- HSTS for HTTPS production traffic

Customer API responses additionally use `Cache-Control: no-store, max-age=0` and `Pragma: no-cache`.

## Operational verification

After deployment, verify a normal signed-in mutation from the web UI and then verify that a cross-origin request is blocked:

```bash
curl -i -X POST \
  -H 'Origin: https://untrusted.example' \
  -H 'Sec-Fetch-Site: cross-site' \
  https://ops.dashboardtalentera.tech/api/customer/auth/logout
```

Expected result: HTTP 403 with `cross_site_request_blocked` and an `x-request-id` response header.

A same-origin browser request must continue normally. Direct HubSpot webhook and OAuth callback behavior must remain unchanged.

## Rollback

Revert the feature commit. Removing `apps/web/proxy.ts` removes the request guard; reverting `apps/web/next.config.mjs` removes the added browser headers. No database migration or secret change is involved.
