#!/usr/bin/env bash
set -Eeuo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
API_SERVICE="${API_SERVICE:-api}"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

case " ${*:-} " in
  *" --workspace "*) ;;
  *)
    echo "A workspace UUID is required. Example:" >&2
    echo "  scripts/recover-webhooks.sh --action status --workspace <uuid>" >&2
    exit 1
    ;;
esac

exec docker compose -f "$COMPOSE_FILE" exec -T "$API_SERVICE" \
  node src/webhook-recovery-cli.js "$@"
