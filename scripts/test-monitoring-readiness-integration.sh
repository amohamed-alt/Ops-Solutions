#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

runner="scripts/run-ops-monitoring-check.sh"
installer="scripts/install-ops-monitoring.sh"
status="scripts/ops-monitoring-status.sh"
notification_wrapper="scripts/readiness-regression-notifications.sh"
dead_letter_wrapper="scripts/readiness-delivery-dead-letter.sh"
dead_letter_health="scripts/readiness-delivery-dead-letter-health.sh"

for file in "$runner" "$installer" "$status" "$notification_wrapper" "$dead_letter_wrapper" "$dead_letter_health"; do
  [[ -f "$file" ]] || { echo "Missing $file" >&2; exit 1; }
  bash -n "$file"
done

grep -Fq 'backup|sla|integrity|readiness|readiness-incidents|readiness-notifications|readiness-dead-letters' "$runner"
grep -Fq 'scripts/onboarding-readiness-operations.sh' "$runner"
grep -Fq 'scripts/readiness-regression-monitor.sh' "$runner"
grep -Fq 'scripts/readiness-regression-notifications.sh' "$runner"
grep -Fq 'scripts/readiness-delivery-dead-letter-health.sh' "$runner"
grep -Fq -- '--freshness-hours "$READINESS_FRESHNESS_HOURS"' "$runner"
grep -Fq -- '--concurrency "$READINESS_CONCURRENCY"' "$runner"
grep -Fq -- '--limit "$READINESS_LIMIT"' "$runner"
grep -Fq -- '--limit "$READINESS_INCIDENT_LIMIT"' "$runner"
grep -Fq -- '--cooldown-minutes "$READINESS_INCIDENT_COOLDOWN_MINUTES"' "$runner"
grep -Fq -- '--limit "$READINESS_NOTIFICATION_LIMIT"' "$runner"
grep -Fq -- '--stale-minutes "$READINESS_NOTIFICATION_STALE_MINUTES"' "$runner"
grep -Fq 'OPS_READINESS_FRESHNESS_HOURS must be between 1 and 168' "$runner"
grep -Fq 'OPS_READINESS_CONCURRENCY must be between 1 and 10' "$runner"
grep -Fq 'OPS_READINESS_WORKSPACE_LIMIT must be between 1 and 10000' "$runner"
grep -Fq 'OPS_READINESS_INCIDENT_LIMIT must be between 1 and 1000' "$runner"
grep -Fq 'OPS_READINESS_INCIDENT_COOLDOWN_MINUTES must be between 15 and 10080' "$runner"
grep -Fq 'OPS_READINESS_NOTIFICATION_LIMIT must be between 1 and 200' "$runner"
grep -Fq 'OPS_READINESS_NOTIFICATION_STALE_MINUTES must be between 5 and 1440' "$runner"
grep -Fq 'OPS_READINESS_DEAD_LETTER_SLA_HOURS must be between 1 and 720' "$runner"
grep -Fq 'OPS_READINESS_DEAD_LETTER_CRITICAL_COUNT must be between 1 and 10000' "$runner"

grep -Fq "write_timer readiness '*:22:00' '5m'" "$installer"
grep -Fq "write_timer readiness-incidents '*:37:00' '5m'" "$installer"
grep -Fq "write_timer readiness-notifications '*:47:00' '5m'" "$installer"
grep -Fq "write_timer readiness-dead-letters '*:57:00' '3m'" "$installer"
grep -Fq 'ops-solutions-monitor-readiness.timer' "$installer"
grep -Fq 'ops-solutions-monitor-readiness-incidents.timer' "$installer"
grep -Fq 'ops-solutions-monitor-readiness-notifications.timer' "$installer"
grep -Fq 'ops-solutions-monitor-readiness-dead-letters.timer' "$installer"
grep -Fq "('backup', 'sla', 'readiness', 'readiness-incidents', 'readiness-notifications', 'readiness-dead-letters', 'integrity')" "$status"

grep -Fq -- '--action status --limit 1' "$dead_letter_health"
grep -Fq '"oldestAgeHours"' "$dead_letter_health"
grep -Fq '"slaBreached"' "$dead_letter_health"
grep -Fq '"countBreached"' "$dead_letter_health"
grep -Fq 'raise SystemExit(exit_code)' "$dead_letter_health"

if OPS_READINESS_DEAD_LETTER_SLA_HOURS=0 bash "$dead_letter_health" >/dev/null 2>&1; then
  echo "Expected invalid dead-letter SLA to fail" >&2
  exit 1
fi
if OPS_READINESS_DEAD_LETTER_CRITICAL_COUNT=0 bash "$dead_letter_health" >/dev/null 2>&1; then
  echo "Expected invalid dead-letter critical count to fail" >&2
  exit 1
fi

echo "Readiness monitoring integration checks passed"
