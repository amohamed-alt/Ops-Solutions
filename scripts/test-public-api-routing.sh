#!/usr/bin/env bash
set -Eeuo pipefail

compose_file="${1:-docker-compose.prod.yml}"

if [[ ! -f "$compose_file" ]]; then
  echo "Compose file not found: $compose_file" >&2
  exit 1
fi

router_rule=$(grep -F 'traefik.http.routers.ops-solutions-api.rule=' "$compose_file" || true)

if [[ -z "$router_rule" ]]; then
  echo "Public API router rule is missing" >&2
  exit 1
fi

required_fragments=(
  'Path(`/health`)'
  'PathPrefix(`/api/v1/hubspot/oauth`)'
  'PathPrefix(`/api/v1/hubspot/webhooks`)'
)

for fragment in "${required_fragments[@]}"; do
  if [[ "$router_rule" != *"$fragment"* ]]; then
    echo "Required public route is missing: $fragment" >&2
    exit 1
  fi
done

for forbidden_fragment in \
  'PathPrefix(`/api/v1`)' \
  'PathPrefix(`/api/v1/workspaces`)' \
  'PathPrefix(`/api/v1/admin`)' \
  'PathPrefix(`/api/v1/operations`)'; do
  if [[ "$router_rule" == *"$forbidden_fragment"* ]]; then
    echo "Administrative API route must not be publicly exposed: $forbidden_fragment" >&2
    exit 1
  fi
done

if ! grep -Fq 'API_INTERNAL_URL: http://api:3001' "$compose_file"; then
  echo "Web service must retain the internal API connection" >&2
  exit 1
fi

if ! grep -Fq '"127.0.0.1:${API_PORT:-3211}:3001"' "$compose_file"; then
  echo "API host port must remain loopback-only" >&2
  exit 1
fi

echo "Public API routing is restricted to health and HubSpot authorization/webhook endpoints."
