#!/usr/bin/env bash
set -Eeuo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
SERVICE="${API_SERVICE:-api}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 4
fi

exec docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" \
  node src/tenant-integrity-cli.js "$@"
