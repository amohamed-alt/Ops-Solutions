#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-$(pwd)}"
RELEASE_ARCHIVE="${RELEASE_ARCHIVE:-}"
MAX_ARCHIVE_AGE_MINUTES="${MAX_ARCHIVE_AGE_MINUTES:-180}"
VERIFY_ATTEMPTS="${VERIFY_ATTEMPTS:-12}"
VERIFY_DELAY_SECONDS="${VERIFY_DELAY_SECONDS:-5}"
LOCK_FILE="${ROLLBACK_LOCK_FILE:-$DEPLOY_PATH/.deploy-backups/rollback.lock}"
STATE_FILE="${ROLLBACK_STATE_FILE:-$DEPLOY_PATH/.deploy-backups/last-rollback.json}"

log() {
  printf '[release-rollback] %s\n' "$*"
}

fail() {
  log "ERROR: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command is unavailable: $1"
}

is_positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

json_escape() {
  local value=${1:-}
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//$'\n'/\\n}
  printf '%s' "$value"
}

select_archive() {
  if [[ -n "$RELEASE_ARCHIVE" ]]; then
    [[ "$RELEASE_ARCHIVE" = /* ]] || RELEASE_ARCHIVE="$DEPLOY_PATH/$RELEASE_ARCHIVE"
  else
    RELEASE_ARCHIVE=$(find "$DEPLOY_PATH/.deploy-backups" -maxdepth 1 -type f -name 'release-*.tar.gz' -printf '%T@ %p\n' 2>/dev/null \
      | sort -nr \
      | awk 'NR == 1 { sub(/^[^ ]+ /, ""); print; exit }')
  fi

  [[ -n "$RELEASE_ARCHIVE" && -f "$RELEASE_ARCHIVE" ]] || fail 'No release archive is available for rollback.'
  [[ "$RELEASE_ARCHIVE" == "$DEPLOY_PATH/.deploy-backups/"release-*.tar.gz ]] \
    || fail 'Rollback archive must be an Ops Solutions release archive inside .deploy-backups.'

  local now modified age_minutes
  now=$(date +%s)
  modified=$(stat -c %Y "$RELEASE_ARCHIVE")
  age_minutes=$(( (now - modified) / 60 ))
  (( age_minutes >= 0 && age_minutes <= MAX_ARCHIVE_AGE_MINUTES )) \
    || fail "Release archive is too old for automatic rollback (${age_minutes} minutes)."
}

validate_archive() {
  gzip -t "$RELEASE_ARCHIVE" || fail 'Release archive failed gzip integrity validation.'
  tar -tzf "$RELEASE_ARCHIVE" >/dev/null || fail 'Release archive catalog is unreadable.'

  if ! tar -tzf "$RELEASE_ARCHIVE" | grep -Eq '^\./docker-compose(\.prod)?\.yml$'; then
    fail 'Release archive does not contain a Docker Compose definition.'
  fi

  if ! tar -tzf "$RELEASE_ARCHIVE" | grep -q '^\./scripts/verify-production.sh$'; then
    fail 'Release archive does not contain the production verifier.'
  fi
}

write_state() {
  local status=$1
  local details=${2:-}
  local temporary
  temporary=$(mktemp "$DEPLOY_PATH/.deploy-backups/.rollback-state.XXXXXX")
  chmod 600 "$temporary"
  printf '{"status":"%s","archive":"%s","completedAt":"%s","details":"%s"}\n' \
    "$(json_escape "$status")" \
    "$(json_escape "$(basename "$RELEASE_ARCHIVE")")" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$(json_escape "$details")" > "$temporary"
  mv -f "$temporary" "$STATE_FILE"
}

rollback() {
  local staging compose_file
  staging=$(mktemp -d "$DEPLOY_PATH/.deploy-backups/rollback-stage.XXXXXX")
  trap 'rm -rf "${staging:-}"' EXIT
  chmod 700 "$staging"

  tar -xzf "$RELEASE_ARCHIVE" -C "$staging"

  [[ ! -e "$staging/.env" ]] || fail 'Release archive unexpectedly contains .env.'
  [[ ! -e "$staging/backups" ]] || fail 'Release archive unexpectedly contains database backups.'
  [[ ! -e "$staging/.deploy-backups" ]] || fail 'Release archive unexpectedly contains deployment archives.'

  log "Restoring application files from $(basename "$RELEASE_ARCHIVE")"
  rsync --archive --delete \
    --exclude='.env' \
    --exclude='.env.*' \
    --exclude='!.env.example' \
    --exclude='.deploy-backups/' \
    --exclude='backups/' \
    --exclude='node_modules/' \
    --exclude='.next/' \
    --exclude='dist/' \
    --exclude='coverage/' \
    --exclude='logs/' \
    "$staging/" "$DEPLOY_PATH/"

  cd "$DEPLOY_PATH"
  [[ -f .env ]] || fail 'Production .env is missing after application rollback.'
  if [[ -f docker-compose.prod.yml ]]; then
    compose_file='docker-compose.prod.yml'
  else
    compose_file='docker-compose.yml'
  fi

  docker compose -f "$compose_file" config --quiet
  docker compose -f "$compose_file" up --detach --build --remove-orphans --wait --wait-timeout 180

  chmod +x scripts/verify-production.sh
  COMPOSE_FILE="$compose_file" \
    VERIFY_MODE=internal \
    VERIFY_ATTEMPTS="$VERIFY_ATTEMPTS" \
    VERIFY_DELAY_SECONDS="$VERIFY_DELAY_SECONDS" \
    scripts/verify-production.sh

  write_state 'completed' 'Previous application release restored and verified. Database contents were not changed.'
  log 'Rollback completed and internal production verification passed.'
}

main() {
  require_command date
  require_command docker
  require_command flock
  require_command gzip
  require_command rsync
  require_command stat
  require_command tar

  is_positive_integer "$MAX_ARCHIVE_AGE_MINUTES" || fail 'MAX_ARCHIVE_AGE_MINUTES must be a positive integer.'
  is_positive_integer "$VERIFY_ATTEMPTS" || fail 'VERIFY_ATTEMPTS must be a positive integer.'
  is_positive_integer "$VERIFY_DELAY_SECONDS" || fail 'VERIFY_DELAY_SECONDS must be a positive integer.'
  [[ -d "$DEPLOY_PATH" ]] || fail "Deployment path does not exist: $DEPLOY_PATH"
  install -m 700 -d "$DEPLOY_PATH/.deploy-backups"

  exec 9>"$LOCK_FILE"
  flock -n 9 || fail 'Another release rollback is already running.'

  select_archive
  validate_archive
  write_state 'running' 'Verified release archive selected; restoring application files only.'

  if ! rollback; then
    write_state 'failed' 'Automatic rollback failed. Review deployment diagnostics and perform manual recovery.' || true
    return 1
  fi
}

main "$@"
