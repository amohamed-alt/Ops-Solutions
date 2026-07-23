#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo '{"error":"docker_required","message":"Docker is required to run the data SLA monitor."}' >&2
  exit 4
fi

if ! docker compose -f "$COMPOSE_FILE" ps --status running api | grep -q api; then
  echo '{"error":"api_not_running","message":"The API container must be running before evaluating data SLAs."}' >&2
  exit 4
fi

docker compose -f "$COMPOSE_FILE" exec -T api node src/data-sla-monitor.js "$@"
