#!/usr/bin/env bash
set -Eeuo pipefail

DESTINATION_ROOT="${DESTINATION_ROOT:-/root/Ops-Solutions/backups/offsite-staging}"
IDENTITY_FILE="${AGE_IDENTITY_FILE:-}"
MANIFEST_FILE=""

usage() {
  cat <<'EOF'
Usage: scripts/verify-encrypted-offsite-backup.sh [options]

Options:
  --destination-root PATH  Encrypted bundle directory
  --manifest FILE          Specific offsite manifest (default: newest)
  --identity-file FILE     Optional age identity for streaming content verification
  -h, --help               Show help

Without an identity, verification validates the manifest, encrypted file size, and SHA-256.
With an identity, age decrypts directly into `tar --list`; no plaintext archive is written.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --destination-root) DESTINATION_ROOT="${2:-}"; shift 2 ;;
    --manifest) MANIFEST_FILE="${2:-}"; shift 2 ;;
    --identity-file) IDENTITY_FILE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

for command_name in python3 sha256sum; do
  command -v "$command_name" >/dev/null || { echo "$command_name is required." >&2; exit 1; }
done
[[ -d "$DESTINATION_ROOT" ]] || { echo "Offsite staging directory does not exist." >&2; exit 1; }

if [[ -z "$MANIFEST_FILE" ]]; then
  MANIFEST_FILE="$(find "$DESTINATION_ROOT" -maxdepth 1 -type f -name 'ops-solutions-*.offsite.json' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n1 | cut -d' ' -f2-)"
fi
[[ -n "$MANIFEST_FILE" && -f "$MANIFEST_FILE" ]] || { echo "Offsite manifest was not found." >&2; exit 1; }

values="$(python3 - "$MANIFEST_FILE" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
try:
    data = json.loads(path.read_text(encoding='utf-8'))
except Exception:
    raise SystemExit('Offsite manifest is invalid.')
required = ('schemaVersion', 'encryptedBundle', 'encryptedSizeBytes', 'encryptedSha256', 'sourceArchive', 'sourceSha256')
if data.get('schemaVersion') != 1 or data.get('encryption') != 'age' or any(key not in data for key in required):
    raise SystemExit('Offsite manifest is incomplete.')
bundle = pathlib.Path(str(data['encryptedBundle'])).name
sha = str(data['encryptedSha256']).lower()
source = pathlib.Path(str(data['sourceArchive'])).name
source_sha = str(data['sourceSha256']).lower()
size = int(data['encryptedSizeBytes'])
if not bundle.endswith('.tar.age') or not source.endswith('.dump') or size < 1:
    raise SystemExit('Offsite manifest contains invalid filenames or size.')
for value in (sha, source_sha):
    if len(value) != 64 or any(c not in '0123456789abcdef' for c in value):
        raise SystemExit('Offsite manifest contains an invalid checksum.')
print(bundle)
print(size)
print(sha)
print(source)
PY
)"
mapfile -t metadata <<< "$values"
bundle_file="$DESTINATION_ROOT/${metadata[0]}"
expected_size="${metadata[1]}"
expected_sha="${metadata[2]}"
source_archive="${metadata[3]}"
[[ -f "$bundle_file" ]] || { echo "Encrypted bundle is missing." >&2; exit 1; }

actual_size="$(stat -c '%s' "$bundle_file")"
actual_sha="$(sha256sum "$bundle_file" | awk '{print $1}')"
[[ "$actual_size" == "$expected_size" ]] || { echo "Encrypted bundle size does not match manifest." >&2; exit 1; }
[[ "$actual_sha" == "$expected_sha" ]] || { echo "Encrypted bundle checksum does not match manifest." >&2; exit 1; }

content_verified=false
if [[ -n "$IDENTITY_FILE" ]]; then
  command -v age >/dev/null || { echo "age is required for content verification." >&2; exit 1; }
  command -v tar >/dev/null || { echo "tar is required for content verification." >&2; exit 1; }
  [[ -f "$IDENTITY_FILE" ]] || { echo "Age identity file does not exist." >&2; exit 1; }
  listing="$(age --decrypt --identity "$IDENTITY_FILE" "$bundle_file" | tar --list --file -)"
  grep -Fxq "$source_archive" <<< "$listing" || { echo "Decrypted bundle does not contain the source archive." >&2; exit 1; }
  grep -Fqx "${source_archive%.dump}.sha256" <<< "$listing" || { echo "Decrypted bundle does not contain the source checksum." >&2; exit 1; }
  grep -Fqx "${source_archive%.dump}.manifest.json" <<< "$listing" || { echo "Decrypted bundle does not contain the source manifest." >&2; exit 1; }
  content_verified=true
fi

printf 'Encrypted bundle verified: %s\n' "$bundle_file"
printf 'Checksum verified: true\n'
printf 'Decrypted content verified: %s\n' "$content_verified"
