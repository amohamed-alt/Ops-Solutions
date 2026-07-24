#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/workspace-onboarding-readiness.sh --workspace <uuid> [--format text|json] [--freshness-hours 24]

Runs the tenant-scoped onboarding readiness evaluator inside the production API container.
Exit codes: 0 ready, 2 incomplete/warning-only, 4 execution/configuration failure.
EOF
}

workspace_id=''
format='text'
freshness_hours='24'

while (($#)); do
  case "$1" in
    --workspace)
      workspace_id="${2:-}"
      shift 2
      ;;
    --format)
      format="${2:-}"
      shift 2
      ;;
    --freshness-hours)
      freshness_hours="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 4
      ;;
  esac
done

if [[ ! "$workspace_id" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  echo 'A workspace UUID is required.' >&2
  exit 4
fi
if [[ "$format" != 'text' && "$format" != 'json' ]]; then
  echo 'Format must be text or json.' >&2
  exit 4
fi
if [[ ! "$freshness_hours" =~ ^[0-9]+$ ]] || ((freshness_hours < 1 || freshness_hours > 168)); then
  echo 'Freshness hours must be an integer between 1 and 168.' >&2
  exit 4
fi

compose_file="${OPS_COMPOSE_FILE:-docker-compose.prod.yml}"
api_service="${OPS_API_SERVICE:-api}"

exec docker compose -f "$compose_file" exec -T "$api_service" \
  node src/onboarding-readiness.js \
  --workspace "$workspace_id" \
  --format "$format" \
  --freshness-hours "$freshness_hours"
