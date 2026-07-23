#!/usr/bin/env bash
set -Eeuo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-/root/Ops-Solutions/backups/postgres}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-26}"
OUTPUT_FORMAT="${OUTPUT_FORMAT:-text}"
VERIFY_ARCHIVE="${VERIFY_ARCHIVE:-true}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"

usage() {
  cat <<'EOF'
Usage: scripts/check-backup-freshness.sh [options]

Options:
  --backup-root PATH       Backup directory (default: /root/Ops-Solutions/backups/postgres)
  --max-age-hours HOURS    Maximum healthy age, 1-720 (default: 26)
  --format text|json       Output format (default: text)
  --skip-archive-check     Skip pg_restore catalog verification
  --compose-file FILE      Docker Compose file used for pg_restore
  -h, --help               Show help

Exit codes:
  0  healthy
  2  stale
  3  missing, incomplete, or corrupt
  4  invalid configuration

The command never prints database credentials, raw backup contents, or environment secrets.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-root) BACKUP_ROOT="${2:-}"; shift 2 ;;
    --max-age-hours) MAX_AGE_HOURS="${2:-}"; shift 2 ;;
    --format) OUTPUT_FORMAT="${2:-}"; shift 2 ;;
    --skip-archive-check) VERIFY_ARCHIVE=false; shift ;;
    --compose-file) COMPOSE_FILE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 4 ;;
  esac
done

if ! [[ "$MAX_AGE_HOURS" =~ ^[0-9]+$ ]] || (( MAX_AGE_HOURS < 1 || MAX_AGE_HOURS > 720 )); then
  echo "MAX_AGE_HOURS must be an integer between 1 and 720." >&2
  exit 4
fi
if [[ "$OUTPUT_FORMAT" != "text" && "$OUTPUT_FORMAT" != "json" ]]; then
  echo "OUTPUT_FORMAT must be text or json." >&2
  exit 4
fi
if [[ "$VERIFY_ARCHIVE" != "true" && "$VERIFY_ARCHIVE" != "false" ]]; then
  echo "VERIFY_ARCHIVE must be true or false." >&2
  exit 4
fi

json_escape() {
  local value="${1:-}"
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//$'\n'/\\n}
  value=${value//$'\r'/\\r}
  value=${value//$'\t'/\\t}
  printf '%s' "$value"
}

emit() {
  local status="$1" message="$2" created_at="${3:-}" age_hours="${4:-null}" file="${5:-}" size_bytes="${6:-null}" checksum_verified="${7:-false}" archive_verified="${8:-false}"
  if [[ "$OUTPUT_FORMAT" == "json" ]]; then
    printf '{"status":"%s","message":"%s","backupRoot":"%s","maxAgeHours":%s,"createdAt":%s,"ageHours":%s,"file":%s,"sizeBytes":%s,"checksumVerified":%s,"archiveVerified":%s}\n' \
      "$(json_escape "$status")" "$(json_escape "$message")" "$(json_escape "$BACKUP_ROOT")" "$MAX_AGE_HOURS" \
      "$( [[ -n "$created_at" ]] && printf '"%s"' "$(json_escape "$created_at")" || printf 'null' )" "$age_hours" \
      "$( [[ -n "$file" ]] && printf '"%s"' "$(json_escape "$file")" || printf 'null' )" "$size_bytes" "$checksum_verified" "$archive_verified"
  else
    printf 'Backup status: %s\n' "$status"
    printf 'Message: %s\n' "$message"
    [[ -n "$created_at" ]] && printf 'Created at: %s\n' "$created_at"
    [[ "$age_hours" != "null" ]] && printf 'Age: %s hours\n' "$age_hours"
    [[ -n "$file" ]] && printf 'File: %s\n' "$file"
    [[ "$size_bytes" != "null" ]] && printf 'Size: %s bytes\n' "$size_bytes"
    printf 'Checksum verified: %s\n' "$checksum_verified"
    printf 'Archive verified: %s\n' "$archive_verified"
  fi
}

if [[ ! -d "$BACKUP_ROOT" ]]; then
  emit "missing" "Backup directory does not exist." "" null "" null false false
  exit 3
fi

latest_manifest="$(find "$BACKUP_ROOT" -maxdepth 1 -type f -name 'ops-solutions-*.manifest.json' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n1 | cut -d' ' -f2-)"
if [[ -z "$latest_manifest" || ! -f "$latest_manifest" ]]; then
  emit "missing" "No PostgreSQL backup manifest was found." "" null "" null false false
  exit 3
fi

command -v python3 >/dev/null || { emit "invalid" "python3 is required to validate backup manifests."; exit 4; }
manifest_values="$(python3 - "$latest_manifest" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
try:
    data = json.loads(path.read_text(encoding='utf-8'))
except Exception:
    sys.exit(2)
required = ('schemaVersion', 'createdAt', 'file', 'sizeBytes', 'sha256')
if any(key not in data for key in required) or data.get('schemaVersion') != 1:
    sys.exit(3)
created = str(data['createdAt']).strip()
file_name = pathlib.Path(str(data['file'])).name
sha = str(data['sha256']).strip().lower()
try:
    size = int(data['sizeBytes'])
except Exception:
    sys.exit(4)
if not created or not file_name.endswith('.dump') or len(sha) != 64 or any(c not in '0123456789abcdef' for c in sha) or size < 1:
    sys.exit(5)
print(created)
print(file_name)
print(size)
print(sha)
PY
)" || {
  emit "corrupt" "Latest backup manifest is malformed or incomplete." "" null "" null false false
  exit 3
}

mapfile -t values <<< "$manifest_values"
created_at="${values[0]}"
file_name="${values[1]}"
manifest_size="${values[2]}"
manifest_sha="${values[3]}"
backup_file="${BACKUP_ROOT}/${file_name}"
checksum_file="${backup_file%.dump}.sha256"

if [[ ! -f "$backup_file" || ! -f "$checksum_file" ]]; then
  emit "incomplete" "Latest backup set is missing its archive or checksum file." "$created_at" null "$file_name" "$manifest_size" false false
  exit 3
fi

actual_size="$(stat -c '%s' "$backup_file" 2>/dev/null || printf 0)"
if [[ "$actual_size" != "$manifest_size" ]]; then
  emit "corrupt" "Backup archive size does not match its manifest." "$created_at" null "$file_name" "$actual_size" false false
  exit 3
fi

command -v sha256sum >/dev/null || { emit "invalid" "sha256sum is required."; exit 4; }
actual_sha="$(sha256sum "$backup_file" | awk '{print $1}')"
checksum_sha="$(awk 'NR == 1 {print $1}' "$checksum_file" 2>/dev/null || true)"
if [[ "$actual_sha" != "$manifest_sha" || "$checksum_sha" != "$manifest_sha" ]]; then
  emit "corrupt" "Backup checksum validation failed." "$created_at" null "$file_name" "$actual_size" false false
  exit 3
fi
checksum_verified=true
archive_verified=false

if [[ "$VERIFY_ARCHIVE" == "true" ]]; then
  command -v docker >/dev/null || { emit "invalid" "docker is required for archive verification." "$created_at" null "$file_name" "$actual_size" true false; exit 4; }
  [[ -f "$COMPOSE_FILE" ]] || { emit "invalid" "Compose file is required for archive verification." "$created_at" null "$file_name" "$actual_size" true false; exit 4; }
  container_id="$(docker compose -f "$COMPOSE_FILE" ps -q "$POSTGRES_SERVICE" 2>/dev/null || true)"
  if [[ -z "$container_id" ]]; then
    emit "invalid" "PostgreSQL service is not running for archive verification." "$created_at" null "$file_name" "$actual_size" true false
    exit 4
  fi
  if ! docker compose -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" pg_restore --list < "$backup_file" >/dev/null 2>&1; then
    emit "corrupt" "PostgreSQL archive catalog validation failed." "$created_at" null "$file_name" "$actual_size" true false
    exit 3
  fi
  archive_verified=true
fi

age_seconds="$(python3 - "$created_at" <<'PY'
from datetime import datetime, timezone
import sys
value = sys.argv[1].replace('Z', '+00:00')
try:
    created = datetime.fromisoformat(value)
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
except ValueError:
    sys.exit(2)
age = int((datetime.now(timezone.utc) - created.astimezone(timezone.utc)).total_seconds())
print(max(age, 0))
PY
)" || {
  emit "corrupt" "Backup creation timestamp is invalid." "$created_at" null "$file_name" "$actual_size" true "$archive_verified"
  exit 3
}
age_hours=$(( age_seconds / 3600 ))

if (( age_seconds > MAX_AGE_HOURS * 3600 )); then
  emit "stale" "Latest verified backup exceeds the configured freshness threshold." "$created_at" "$age_hours" "$file_name" "$actual_size" true "$archive_verified"
  exit 2
fi

emit "healthy" "Latest PostgreSQL backup is complete, verified, and fresh." "$created_at" "$age_hours" "$file_name" "$actual_size" true "$archive_verified"
