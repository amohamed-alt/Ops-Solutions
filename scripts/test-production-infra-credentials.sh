#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$repo_root/docker-compose.prod.yml"

fail() {
  printf 'production infra credential contract failed: %s\n' "$1" >&2
  exit 1
}

if grep -q 'ops_solutions_bootstrap_only' "$compose_file"; then
  fail 'bootstrap database password must not exist in production compose'
fi

for required in POSTGRES_PASSWORD DATABASE_URL REDIS_PASSWORD REDIS_URL; do
  grep -Fq "\${${required}:?" "$compose_file" \
    || fail "$required must use required-variable interpolation"
done

for email_setting in EMAIL_PROVIDER EMAIL_FROM_ADDRESS EMAIL_FROM_NAME RESEND_API_KEY POSTMARK_SERVER_TOKEN EMAIL_DELIVERY_POLL_INTERVAL_MS; do
  grep -Fq "${email_setting}: \${${email_setting}:-" "$compose_file" \
    || fail "$email_setting must be forwarded into the API runtime"
done

grep -Fq 'EMAIL_PROVIDER: ${EMAIL_PROVIDER:-disabled}' "$compose_file" \
  || fail 'email delivery must remain disabled by default'
grep -Fq 'EMAIL_DELIVERY_POLL_INTERVAL_MS: ${EMAIL_DELIVERY_POLL_INTERVAL_MS:-60000}' "$compose_file" \
  || fail 'email delivery polling must keep the documented bounded default'

grep -Fq -- '--requirepass "$${REDIS_PASSWORD}"' "$compose_file" \
  || fail 'Redis must start with requirepass'

grep -Fq 'redis-cli -a \"$${REDIS_PASSWORD}\" --no-auth-warning ping' "$compose_file" \
  || fail 'Redis healthcheck must authenticate'

if POSTGRES_PASSWORD= DATABASE_URL= REDIS_PASSWORD= REDIS_URL= \
  docker compose -f "$compose_file" config --quiet >/tmp/ops-infra-missing.log 2>&1; then
  fail 'production compose unexpectedly accepted missing credentials'
fi

grep -Eq 'POSTGRES_PASSWORD|DATABASE_URL|REDIS_PASSWORD|REDIS_URL' /tmp/ops-infra-missing.log \
  || fail 'missing-credential failure did not explain the required variable'

POSTGRES_PASSWORD='ci-postgres-password' \
DATABASE_URL='postgresql://ops_solutions:ci-postgres-password@postgres:5432/ops_solutions' \
REDIS_PASSWORD='ci-redis-password' \
REDIS_URL='redis://:ci-redis-password@redis:6379' \
EMAIL_PROVIDER='resend' \
EMAIL_FROM_ADDRESS='reports@example.test' \
EMAIL_FROM_NAME='Ops Intelligence' \
RESEND_API_KEY='ci-placeholder-not-a-secret' \
POSTMARK_SERVER_TOKEN='' \
EMAIL_DELIVERY_POLL_INTERVAL_MS='60000' \
docker compose -f "$compose_file" config --quiet

printf 'production infra credential contract passed\n'
