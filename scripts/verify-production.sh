#!/usr/bin/env bash
set -Eeuo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://ops.dashboardtalentera.tech}"
API_PORT="${API_PORT:-3211}"
WEB_PORT="${WEB_PORT:-3210}"
VERIFY_MODE="${VERIFY_MODE:-all}"
ATTEMPTS="${VERIFY_ATTEMPTS:-12}"
DELAY_SECONDS="${VERIFY_DELAY_SECONDS:-5}"
HTTP_TIMEOUT="${VERIFY_HTTP_TIMEOUT:-15}"
EXPECTED_SERVICES=(postgres redis api worker web)

log() {
  printf '[production-verify] %s\n' "$*"
}

fail() {
  printf '[production-verify] ERROR: %s\n' "$*" >&2
  exit 1
}

retry() {
  local description="$1"
  shift
  local attempt=1
  while (( attempt <= ATTEMPTS )); do
    if "$@"; then
      log "$description: ok"
      return 0
    fi
    if (( attempt == ATTEMPTS )); then
      fail "$description failed after ${ATTEMPTS} attempts"
    fi
    log "$description: attempt ${attempt}/${ATTEMPTS} failed; retrying in ${DELAY_SECONDS}s"
    sleep "$DELAY_SECONDS"
    attempt=$((attempt + 1))
  done
}

curl_ok() {
  local url="$1"
  curl \
    --fail \
    --silent \
    --show-error \
    --location \
    --max-time "$HTTP_TIMEOUT" \
    --retry 0 \
    --output /dev/null \
    "$url"
}

curl_contains() {
  local url="$1"
  local expected="$2"
  local body
  body="$(curl \
    --fail \
    --silent \
    --show-error \
    --location \
    --max-time "$HTTP_TIMEOUT" \
    --retry 0 \
    "$url")" || return 1
  grep -Fqi -- "$expected" <<<"$body"
}

verify_containers() {
  [[ -f "$COMPOSE_FILE" ]] || fail "Compose file not found: $COMPOSE_FILE"

  local service container_id status health
  for service in "${EXPECTED_SERVICES[@]}"; do
    container_id="$(docker compose -f "$COMPOSE_FILE" ps -q "$service")"
    [[ -n "$container_id" ]] || fail "Service has no container: $service"

    status="$(docker inspect --format '{{.State.Status}}' "$container_id")"
    [[ "$status" == "running" ]] || fail "Service $service is $status"

    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id")"
    if [[ "$health" != "healthy" && "$health" != "none" ]]; then
      fail "Service $service health is $health"
    fi
    log "service=$service status=$status health=$health"
  done
}

verify_internal_endpoints() {
  retry "internal API health" curl_contains "http://127.0.0.1:${API_PORT}/health" '"status":"healthy"'
  retry "internal web health" curl_ok "http://127.0.0.1:${WEB_PORT}/api/health"
  retry "internal onboarding page" curl_contains "http://127.0.0.1:${WEB_PORT}/onboarding" "Connect HubSpot"
}

verify_public_endpoints() {
  local base="${PUBLIC_BASE_URL%/}"
  retry "public web health" curl_ok "${base}/api/health"
  retry "public onboarding page" curl_contains "${base}/onboarding" "Connect HubSpot"
  retry "public dashboard route" curl_ok "${base}/dashboard"
}

case "$VERIFY_MODE" in
  internal)
    verify_containers
    verify_internal_endpoints
    ;;
  public)
    verify_public_endpoints
    ;;
  all)
    verify_containers
    verify_internal_endpoints
    verify_public_endpoints
    ;;
  *)
    fail "VERIFY_MODE must be internal, public, or all"
    ;;
esac

log "production verification completed successfully"
