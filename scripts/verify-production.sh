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
EXPECTED_RELEASE_SHA="${EXPECTED_RELEASE_SHA:-}"
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

verify_release() {
  local description="$1"
  local url="$2"
  if [[ -n "$EXPECTED_RELEASE_SHA" ]]; then
    retry "$description" curl_contains "$url" "\"release\":\"${EXPECTED_RELEASE_SHA}\""
  else
    retry "$description" curl_ok "$url"
  fi
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

verify_internal_core_report() {
  docker compose -f "$COMPOSE_FILE" exec -T api node --input-type=module <<'NODE'
const adminKey = String(process.env.ADMIN_API_KEY || '');
if (!adminKey) throw new Error('ADMIN_API_KEY is unavailable inside the API container.');
const headers = { 'x-admin-key': adminKey };
const workspaceResponse = await fetch('http://127.0.0.1:3001/api/v1/workspaces', {
  headers,
  signal: AbortSignal.timeout(15_000)
});
if (!workspaceResponse.ok) throw new Error(`Workspace smoke request returned ${workspaceResponse.status}.`);
const workspacePayload = await workspaceResponse.json();
const rows = Array.isArray(workspacePayload.results) ? workspacePayload.results : [];
const workspace = rows.find((row) => row.status === 'active' && row.hubspot_status === 'connected')
  ?? rows.find((row) => row.status === 'active')
  ?? rows[0];
if (!workspace?.id) {
  console.log('No workspace is available; core report smoke check skipped.');
  process.exit(0);
}
const to = new Date();
const from = new Date(to);
from.setUTCDate(from.getUTCDate() - 6);
const reportUrl = new URL(`http://127.0.0.1:3001/api/v1/workspaces/${encodeURIComponent(workspace.id)}/analytics/revenue`);
reportUrl.searchParams.set('scope', 'core');
reportUrl.searchParams.set('from', from.toISOString().slice(0, 10));
reportUrl.searchParams.set('to', to.toISOString().slice(0, 10));
const reportResponse = await fetch(reportUrl, {
  headers,
  signal: AbortSignal.timeout(70_000)
});
if (!reportResponse.ok) throw new Error(`Core revenue report returned ${reportResponse.status}.`);
const reportPayload = await reportResponse.json();
if (reportPayload.scope !== 'core' || !reportPayload.report?.overview || !reportPayload.report?.filterOptions) {
  throw new Error('Core revenue report response contract is incomplete.');
}
console.log('Core revenue report smoke check passed.');
NODE
}

verify_internal_endpoints() {
  retry "internal API health" curl_contains "http://127.0.0.1:${API_PORT}/health" '"status":"healthy"'
  retry "internal web health" curl_ok "http://127.0.0.1:${WEB_PORT}/api/health"
  verify_release "internal web release" "http://127.0.0.1:${WEB_PORT}/api/release"
  retry "internal onboarding page" curl_contains "http://127.0.0.1:${WEB_PORT}/onboarding" "Connect HubSpot"
  log "internal core revenue report: starting"
  verify_internal_core_report || fail "internal core revenue report failed"
  log "internal core revenue report: ok"
}

verify_public_endpoints() {
  local base="${PUBLIC_BASE_URL%/}"
  retry "public web health" curl_ok "${base}/api/health"
  verify_release "public web release" "${base}/api/release"
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
