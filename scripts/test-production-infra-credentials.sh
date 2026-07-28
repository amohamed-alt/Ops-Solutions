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
docker compose -f "$compose_file" config --quiet

printf 'production infra credential contract passed\n'
