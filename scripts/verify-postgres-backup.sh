#!/usr/bin/env bash
set -Eeuo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
BACKUP_FILE=""

usage() {
  cat <<'EOF'
Usage: scripts/verify-postgres-backup.sh --file PATH [--compose-file FILE]

Validates the matching SHA-256 file when present and asks pg_restore to parse the full archive catalog.
No database is modified.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) BACKUP_FILE="$2"; shift 2 ;;
    --compose-file) COMPOSE_FILE="$2"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -n "$BACKUP_FILE" ]] || { echo "--file is required." >&2; exit 2; }
[[ -f "$BACKUP_FILE" && -s "$BACKUP_FILE" ]] || { echo "Backup file is missing or empty: $BACKUP_FILE" >&2; exit 1; }
[[ -f "$COMPOSE_FILE" ]] || { echo "Compose file not found: $COMPOSE_FILE" >&2; exit 1; }
command -v docker >/dev/null || { echo "docker is required." >&2; exit 1; }
command -v sha256sum >/dev/null || { echo "sha256sum is required." >&2; exit 1; }

checksum_file="${BACKUP_FILE%.dump}.sha256"
if [[ -f "$checksum_file" ]]; then
  expected="$(awk 'NR==1 {print $1}' "$checksum_file")"
  actual="$(sha256sum "$BACKUP_FILE" | awk '{print $1}')"
  [[ "$expected" == "$actual" ]] || { echo "Checksum verification failed." >&2; exit 1; }
fi

docker compose -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" pg_restore --list < "$BACKUP_FILE" >/dev/null
printf 'Backup verified successfully: %s\n' "$BACKUP_FILE"
