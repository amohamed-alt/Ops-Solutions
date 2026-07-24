#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${OPS_DEPLOY_PATH:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${OPS_ENV_FILE:-${ROOT_DIR}/.env}"
FORMAT="${1:-text}"

if [[ "$FORMAT" != "text" && "$FORMAT" != "json" ]]; then
  echo "Format must be text or json." >&2
  exit 4
fi

cd "$ROOT_DIR"
exec node scripts/runtime-config-audit.mjs \
  --env-file "$ENV_FILE" \
  --template-file .env.example \
  --format "$FORMAT"
