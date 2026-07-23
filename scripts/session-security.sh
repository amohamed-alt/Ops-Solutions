#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_PATH="${OPS_DEPLOY_PATH:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
COMPOSE_FILE="${OPS_COMPOSE_FILE:-docker-compose.prod.yml}"

cd "$DEPLOY_PATH"
exec docker compose -f "$COMPOSE_FILE" exec -T api node bin/session-security.js "$@"
