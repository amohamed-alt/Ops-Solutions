#!/usr/bin/env bash
set -Eeuo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
BACKUP_FILE=""
TARGET_DATABASE=""
CONFIRMATION=""
ALLOW_PRODUCTION_TARGET="false"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/restore-postgres-backup.sh --file PATH --target-database NAME --confirm RESTORE
    [--compose-file FILE] [--allow-production-target]

The command verifies the archive, recreates the target database, restores with --no-owner/--no-acl,
and validates critical Ops Solutions tables. Restoring into the configured production database is
blocked unless --allow-production-target is supplied explicitly.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) BACKUP_FILE="$2"; shift 2 ;;
    --target-database) TARGET_DATABASE="$2"; shift 2 ;;
    --confirm) CONFIRMATION="$2"; shift 2 ;;
    --compose-file) COMPOSE_FILE="$2"; shift 2 ;;
    --allow-production-target) ALLOW_PRODUCTION_TARGET="true"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -n "$BACKUP_FILE" ]] || { echo "--file is required." >&2; exit 2; }
[[ -n "$TARGET_DATABASE" ]] || { echo "--target-database is required." >&2; exit 2; }
[[ "$CONFIRMATION" == "RESTORE" ]] || { echo "Use --confirm RESTORE to acknowledge the destructive database recreation." >&2; exit 2; }
[[ "$TARGET_DATABASE" =~ ^[a-zA-Z_][a-zA-Z0-9_]{0,62}$ ]] || { echo "Target database name is invalid." >&2; exit 2; }
[[ -f "$BACKUP_FILE" && -s "$BACKUP_FILE" ]] || { echo "Backup file is missing or empty: $BACKUP_FILE" >&2; exit 1; }
[[ -f "$COMPOSE_FILE" ]] || { echo "Compose file not found: $COMPOSE_FILE" >&2; exit 1; }
command -v docker >/dev/null || { echo "docker is required." >&2; exit 1; }

read -r db_user production_db < <(
  docker compose -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" sh -ceu '
    printf "%s %s\n" "${POSTGRES_USER:?POSTGRES_USER is required}" "${POSTGRES_DB:?POSTGRES_DB is required}"
  '
)

if [[ "$TARGET_DATABASE" == "$production_db" && "$ALLOW_PRODUCTION_TARGET" != "true" ]]; then
  echo "Refusing to restore into the configured production database without --allow-production-target." >&2
  exit 3
fi

bash scripts/verify-postgres-backup.sh --file "$BACKUP_FILE" --compose-file "$COMPOSE_FILE"

# Terminate only sessions connected to the explicit target database.
docker compose -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" \
  psql --username="$db_user" --dbname=postgres --set=ON_ERROR_STOP=1 \
  --variable=target_db="$TARGET_DATABASE" <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = :'target_db' AND pid <> pg_backend_pid();
SQL

docker compose -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" \
  dropdb --username="$db_user" --if-exists "$TARGET_DATABASE"
docker compose -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" \
  createdb --username="$db_user" "$TARGET_DATABASE"

docker compose -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" \
  pg_restore --username="$db_user" --dbname="$TARGET_DATABASE" --no-owner --no-acl --exit-on-error \
  < "$BACKUP_FILE"

docker compose -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" \
  psql --username="$db_user" --dbname="$TARGET_DATABASE" --set=ON_ERROR_STOP=1 --tuples-only <<'SQL' >/dev/null
SELECT 1 FROM workspaces LIMIT 1;
SELECT 1 FROM schema_migrations LIMIT 1;
SQL

printf 'Restore completed and validated for target database: %s\n' "$TARGET_DATABASE"
