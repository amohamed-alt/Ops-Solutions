#!/usr/bin/env bash
set -Eeuo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/Ops-Solutions/backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
LOCK_FILE="${LOCK_FILE:-/tmp/ops-solutions-postgres-backup.lock}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
HOSTNAME_SAFE="$(hostname | tr -cd '[:alnum:]._-')"
PREFIX="ops-solutions-${HOSTNAME_SAFE:-host}-${TIMESTAMP}"
BACKUP_FILE="${BACKUP_ROOT}/${PREFIX}.dump"
MANIFEST_FILE="${BACKUP_ROOT}/${PREFIX}.manifest.json"
CHECKSUM_FILE="${BACKUP_ROOT}/${PREFIX}.sha256"

usage() {
  cat <<'EOF'
Usage: scripts/backup-postgres.sh [--backup-root PATH] [--retention-days DAYS] [--compose-file FILE]

Creates a PostgreSQL custom-format backup, verifies it with pg_restore, writes a SHA-256 checksum
and JSON manifest, then removes expired backup sets. Production secrets are never printed.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-root) BACKUP_ROOT="$2"; shift 2 ;;
    --retention-days) RETENTION_DAYS="$2"; shift 2 ;;
    --compose-file) COMPOSE_FILE="$2"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if ! [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || (( RETENTION_DAYS < 1 || RETENTION_DAYS > 365 )); then
  echo "RETENTION_DAYS must be an integer between 1 and 365." >&2
  exit 2
fi

command -v docker >/dev/null || { echo "docker is required." >&2; exit 1; }
command -v sha256sum >/dev/null || { echo "sha256sum is required." >&2; exit 1; }
command -v flock >/dev/null || { echo "flock is required." >&2; exit 1; }
[[ -f "$COMPOSE_FILE" ]] || { echo "Compose file not found: $COMPOSE_FILE" >&2; exit 1; }

mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another PostgreSQL backup is already running." >&2
  exit 75
fi

cleanup_partial() {
  local status=$?
  if (( status != 0 )); then
    rm -f "$BACKUP_FILE" "$MANIFEST_FILE" "$CHECKSUM_FILE"
  fi
  exit "$status"
}
trap cleanup_partial EXIT

container_id="$(docker compose -f "$COMPOSE_FILE" ps -q "$POSTGRES_SERVICE")"
[[ -n "$container_id" ]] || { echo "PostgreSQL service is not running." >&2; exit 1; }

read -r db_user db_name < <(
  docker compose -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" sh -ceu '
    printf "%s %s\n" "${POSTGRES_USER:?POSTGRES_USER is required}" "${POSTGRES_DB:?POSTGRES_DB is required}"
  '
)

umask 077
tmp_file="${BACKUP_FILE}.partial"
docker compose -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" \
  pg_dump --username="$db_user" --dbname="$db_name" --format=custom --compress=6 --no-owner --no-acl \
  > "$tmp_file"

[[ -s "$tmp_file" ]] || { echo "Backup output is empty." >&2; exit 1; }
mv "$tmp_file" "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"

# Verify the archive is structurally readable before publishing its manifest.
docker compose -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" \
  pg_restore --list < "$BACKUP_FILE" >/dev/null

checksum="$(sha256sum "$BACKUP_FILE" | awk '{print $1}')"
printf '%s  %s\n' "$checksum" "$(basename "$BACKUP_FILE")" > "$CHECKSUM_FILE"
chmod 600 "$CHECKSUM_FILE"

size_bytes="$(stat -c '%s' "$BACKUP_FILE")"
cat > "$MANIFEST_FILE" <<EOF
{
  "schemaVersion": 1,
  "application": "Ops Solutions",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "database": "${db_name}",
  "format": "postgres-custom",
  "file": "$(basename "$BACKUP_FILE")",
  "sizeBytes": ${size_bytes},
  "sha256": "${checksum}",
  "retentionDays": ${RETENTION_DAYS}
}
EOF
chmod 600 "$MANIFEST_FILE"

find "$BACKUP_ROOT" -maxdepth 1 -type f \
  \( -name 'ops-solutions-*.dump' -o -name 'ops-solutions-*.sha256' -o -name 'ops-solutions-*.manifest.json' \) \
  -mtime "+${RETENTION_DAYS}" -delete

trap - EXIT
printf 'Backup completed: %s\n' "$BACKUP_FILE"
printf 'Manifest: %s\n' "$MANIFEST_FILE"
printf 'Size: %s bytes\n' "$size_bytes"
