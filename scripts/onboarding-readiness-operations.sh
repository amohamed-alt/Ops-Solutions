#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if command -v docker >/dev/null 2>&1 && docker compose ps --services 2>/dev/null | grep -qx 'api'; then
  exec docker compose exec -T api node src/onboarding-readiness-operations.js "$@"
fi

exec node apps/api/src/onboarding-readiness-operations.js "$@"
