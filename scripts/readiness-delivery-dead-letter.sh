#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACTION="status"
LIMIT="100"
WORKSPACE_ID=""
DELIVERY_ID=""
APPLY="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --action)
      ACTION="${2:-}"
      shift 2
      ;;
    --limit)
      LIMIT="${2:-}"
      shift 2
      ;;
    --workspace)
      WORKSPACE_ID="${2:-}"
      shift 2
      ;;
    --delivery)
      DELIVERY_ID="${2:-}"
      shift 2
      ;;
    --apply)
      APPLY="true"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 4
      ;;
  esac
done

ARGS=(--action "$ACTION" --limit "$LIMIT")
[[ -n "$WORKSPACE_ID" ]] && ARGS+=(--workspace "$WORKSPACE_ID")
[[ -n "$DELIVERY_ID" ]] && ARGS+=(--delivery "$DELIVERY_ID")
[[ "$APPLY" == "true" ]] && ARGS+=(--apply)

cd "$ROOT_DIR"

if command -v docker >/dev/null 2>&1 && docker compose ps api --status running --quiet 2>/dev/null | grep -q .; then
  exec docker compose exec -T api node src/readiness-delivery-dead-letter.js "${ARGS[@]}"
fi

if [[ -d apps/api/node_modules ]]; then
  exec node apps/api/src/readiness-delivery-dead-letter.js "${ARGS[@]}"
fi

echo "API runtime is unavailable. Start the api service or install apps/api dependencies." >&2
exit 4
