# Worker validation

The GitHub Actions workflow validates every JavaScript file in `apps/worker/src` with Node.js syntax checks. Runtime integration validation requires PostgreSQL, Redis, an encrypted HubSpot connection and OAuth credentials, so it is performed only after the production deployment secret and environment file are configured.
