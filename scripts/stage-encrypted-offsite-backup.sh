#!/usr/bin/env bash
set -Eeuo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-/root/Ops-Solutions/backups/postgres}"
DESTINATION_ROOT="${DESTINATION_ROOT:-/root/Ops-Solutions/backups/offsite-staging}"
AGE_RECIPIENT_FILE="${AGE_RECIPIENT_FILE:-/root/Ops-Solutions/.backup-age-recipient}"
RETENTION_DAYS="${OFFSITE_RETENTION_DAYS:-35}"
LOCK_FILE="${OFFSITE_LOCK_FILE:-/tmp/ops-solutions-offsite-backup.lock}"
DRY_RUN=false

usage() {
  cat <<'EOF'
Usage: scripts/stage-encrypted-offsite-backup.sh [options]

Encrypts the newest verified PostgreSQL backup set with age and atomically stages it in a
provider-neutral destination directory. The destination can be a mounted encrypted volume,
object-storage mount, or directory replicated by infrastructure tooling.

Options:
  --backup-root PATH        Local verified backup directory
  --destination-root PATH   Offsite staging directory
  --recipient-file PATH     File containing one age recipient (public key)
  --retention-days DAYS     Retain encrypted bundles for 7-365 days (default: 35)
  --dry-run                 Validate and describe work without writing an encrypted bundle
  -h, --help                Show help

The script never reads an age private key and never prints database credentials, tokens, or
backup contents.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-root) BACKUP_ROOT="${2:-}"; shift 2 ;;
    --destination-root) DESTINATION_ROOT="${2:-}"; shift 2 ;;
    --recipient-file) AGE_RECIPIENT_FILE="${2:-}"; shift 2 ;;
    --retention-days) RETENTION_DAYS="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if ! [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || (( RETENTION_DAYS < 7 || RETENTION_DAYS > 365 )); then
  echo "RETENTION_DAYS must be an integer between 7 and 365." >&2
  exit 2
fi

for command_name in age flock python3 sha256sum tar; do
  command -v "$command_name" >/dev/null || { echo "$command_name is required." >&2; exit 1; }
done
[[ -d "$BACKUP_ROOT" ]] || { echo "Backup directory does not exist." >&2; exit 1; }
[[ -f "$AGE_RECIPIENT_FILE" ]] || { echo "Age recipient file does not exist." >&2; exit 1; }

recipient="$(awk 'NF && $1 !~ /^#/ { print $1; exit }' "$AGE_RECIPIENT_FILE")"
if [[ ! "$recipient" =~ ^age1[0-9a-z]+$ && ! "$recipient" =~ ^ssh-(rsa|ed25519)[[:space:]] ]]; then
  echo "Recipient file must contain a valid age or supported SSH public recipient." >&2
  exit 2
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another offsite staging operation is already running." >&2
  exit 75
fi

latest_manifest="$(find "$BACKUP_ROOT" -maxdepth 1 -type f -name 'ops-solutions-*.manifest.json' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n1 | cut -d' ' -f2-)"
[[ -n "$latest_manifest" && -f "$latest_manifest" ]] || { echo "No backup manifest was found." >&2; exit 1; }

manifest_values="$(python3 - "$latest_manifest" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
try:
    data = json.loads(path.read_text(encoding='utf-8'))
except Exception:
    raise SystemExit('Backup manifest is invalid.')
required = ('schemaVersion', 'createdAt', 'file', 'sizeBytes', 'sha256')
if data.get('schemaVersion') != 1 or any(key not in data for key in required):
    raise SystemExit('Backup manifest is incomplete.')
name = pathlib.Path(str(data['file'])).name
sha = str(data['sha256']).lower()
if not name.endswith('.dump') or len(sha) != 64 or any(c not in '0123456789abcdef' for c in sha):
    raise SystemExit('Backup manifest contains invalid archive metadata.')
print(name)
print(sha)
print(int(data['sizeBytes']))
print(str(data['createdAt']))
PY
)"
mapfile -t metadata <<< "$manifest_values"
archive_name="${metadata[0]}"
manifest_sha="${metadata[1]}"
manifest_size="${metadata[2]}"
created_at="${metadata[3]}"
archive_file="$BACKUP_ROOT/$archive_name"
checksum_file="${archive_file%.dump}.sha256"

[[ -f "$archive_file" && -f "$checksum_file" ]] || { echo "Backup set is incomplete." >&2; exit 1; }
actual_size="$(stat -c '%s' "$archive_file")"
actual_sha="$(sha256sum "$archive_file" | awk '{print $1}')"
checksum_sha="$(awk 'NR == 1 {print $1}' "$checksum_file")"
if [[ "$actual_size" != "$manifest_size" || "$actual_sha" != "$manifest_sha" || "$checksum_sha" != "$manifest_sha" ]]; then
  echo "Backup verification failed; offsite staging was aborted." >&2
  exit 1
fi

bundle_base="${archive_name%.dump}"
bundle_name="${bundle_base}.tar.age"
bundle_manifest_name="${bundle_base}.offsite.json"

if [[ "$DRY_RUN" == "true" ]]; then
  printf 'Verified backup: %s\n' "$archive_name"
  printf 'Created at: %s\n' "$created_at"
  printf 'Encrypted bundle: %s/%s\n' "$DESTINATION_ROOT" "$bundle_name"
  printf 'Dry run completed; no files were written.\n'
  exit 0
fi

mkdir -p "$DESTINATION_ROOT"
chmod 700 "$DESTINATION_ROOT"
umask 077
partial_bundle="$DESTINATION_ROOT/.${bundle_name}.partial"
final_bundle="$DESTINATION_ROOT/$bundle_name"
partial_manifest="$DESTINATION_ROOT/.${bundle_manifest_name}.partial"
final_manifest="$DESTINATION_ROOT/$bundle_manifest_name"

cleanup() {
  local status=$?
  rm -f "$partial_bundle" "$partial_manifest"
  exit "$status"
}
trap cleanup EXIT

# Stream a deterministic three-file backup set into age. No plaintext tar archive is written.
tar --create --directory "$BACKUP_ROOT" \
  --owner=0 --group=0 --numeric-owner \
  "$archive_name" "$(basename "$checksum_file")" "$(basename "$latest_manifest")" \
  | age --encrypt --recipient "$recipient" --output "$partial_bundle"

[[ -s "$partial_bundle" ]] || { echo "Encrypted bundle is empty." >&2; exit 1; }
chmod 600 "$partial_bundle"
encrypted_sha="$(sha256sum "$partial_bundle" | awk '{print $1}')"
encrypted_size="$(stat -c '%s' "$partial_bundle")"

cat > "$partial_manifest" <<EOF
{
  "schemaVersion": 1,
  "application": "Ops Solutions",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "sourceCreatedAt": "${created_at}",
  "sourceArchive": "${archive_name}",
  "sourceSha256": "${manifest_sha}",
  "encryptedBundle": "${bundle_name}",
  "encryptedSizeBytes": ${encrypted_size},
  "encryptedSha256": "${encrypted_sha}",
  "encryption": "age",
  "retentionDays": ${RETENTION_DAYS}
}
EOF
chmod 600 "$partial_manifest"

mv "$partial_bundle" "$final_bundle"
mv "$partial_manifest" "$final_manifest"

# Remove only complete encrypted bundle sets older than retention. Never touch local database backups.
find "$DESTINATION_ROOT" -maxdepth 1 -type f \
  \( -name 'ops-solutions-*.tar.age' -o -name 'ops-solutions-*.offsite.json' \) \
  -mtime "+${RETENTION_DAYS}" -delete

trap - EXIT
printf 'Encrypted offsite bundle staged: %s\n' "$final_bundle"
printf 'Offsite manifest: %s\n' "$final_manifest"
printf 'Encrypted size: %s bytes\n' "$encrypted_size"
