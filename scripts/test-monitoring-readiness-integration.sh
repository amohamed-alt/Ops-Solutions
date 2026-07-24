#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

runner="scripts/run-ops-monitoring-check.sh"
installer="scripts/install-ops-monitoring.sh"
status="scripts/ops-monitoring-status.sh"

for file in "$runner" "$installer" "$status"; do
  [[ -f "$file" ]] || { echo "Missing $file" >&2; exit 1; }
  bash -n "$file"
done

grep -Fq 'backup|sla|integrity|readiness' "$runner"
grep -Fq 'scripts/onboarding-readiness-operations.sh' "$runner"
grep -Fq -- '--freshness-hours "$READINESS_FRESHNESS_HOURS"' "$runner"
grep -Fq -- '--concurrency "$READINESS_CONCURRENCY"' "$runner"
grep -Fq -- '--limit "$READINESS_LIMIT"' "$runner"
grep -Fq 'OPS_READINESS_FRESHNESS_HOURS must be between 1 and 168' "$runner"
grep -Fq 'OPS_READINESS_CONCURRENCY must be between 1 and 10' "$runner"
grep -Fq 'OPS_READINESS_WORKSPACE_LIMIT must be between 1 and 10000' "$runner"

grep -Fq "write_timer readiness '*:22:00' '5m'" "$installer"
grep -Fq 'ops-solutions-monitor-readiness.timer' "$installer"
grep -Fq "('backup', 'sla', 'readiness', 'integrity')" "$status"

echo "Readiness monitoring integration checks passed"
