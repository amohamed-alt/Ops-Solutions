#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SLA_HOURS="${OPS_READINESS_DEAD_LETTER_SLA_HOURS:-24}"
CRITICAL_COUNT="${OPS_READINESS_DEAD_LETTER_CRITICAL_COUNT:-10}"

[[ "$SLA_HOURS" =~ ^[0-9]+$ ]] || { echo "OPS_READINESS_DEAD_LETTER_SLA_HOURS must be numeric" >&2; exit 4; }
[[ "$CRITICAL_COUNT" =~ ^[0-9]+$ ]] || { echo "OPS_READINESS_DEAD_LETTER_CRITICAL_COUNT must be numeric" >&2; exit 4; }
(( SLA_HOURS >= 1 && SLA_HOURS <= 720 )) || { echo "OPS_READINESS_DEAD_LETTER_SLA_HOURS must be between 1 and 720" >&2; exit 4; }
(( CRITICAL_COUNT >= 1 && CRITICAL_COUNT <= 10000 )) || { echo "OPS_READINESS_DEAD_LETTER_CRITICAL_COUNT must be between 1 and 10000" >&2; exit 4; }
command -v python3 >/dev/null 2>&1 || { echo "python3 is required" >&2; exit 4; }

payload_file="$(mktemp)"
trap 'rm -f "$payload_file"' EXIT

cd "$ROOT_DIR"
bash scripts/readiness-delivery-dead-letter.sh --action status --limit 1 >"$payload_file"

python3 - "$payload_file" "$SLA_HOURS" "$CRITICAL_COUNT" <<'PY'
import datetime as dt
import json
import pathlib
import sys

payload_path = pathlib.Path(sys.argv[1])
sla_hours = int(sys.argv[2])
critical_count = int(sys.argv[3])

try:
    payload = json.loads(payload_path.read_text())
except Exception as exc:
    print(json.dumps({
        "schemaVersion": 1,
        "status": "critical",
        "exitCode": 4,
        "error": f"invalid_dead_letter_status_payload:{type(exc).__name__}",
    }, separators=(",", ":")))
    raise SystemExit(4)

summary = payload.get("summary") or {}
total = int(summary.get("total") or 0)
regression = int(summary.get("regression") or 0)
recovery = int(summary.get("recovery") or 0)
oldest_raw = summary.get("oldest_updated_at") or summary.get("oldestUpdatedAt")
age_hours = None

if oldest_raw:
    try:
        oldest = dt.datetime.fromisoformat(str(oldest_raw).replace("Z", "+00:00"))
        if oldest.tzinfo is None:
            oldest = oldest.replace(tzinfo=dt.timezone.utc)
        age_hours = max(0, int((dt.datetime.now(dt.timezone.utc) - oldest).total_seconds() // 3600))
    except (TypeError, ValueError):
        age_hours = None

sla_breached = total > 0 and (age_hours is None or age_hours >= sla_hours)
count_breached = total >= critical_count
if total == 0:
    status, exit_code = "healthy", 0
elif sla_breached or count_breached:
    status, exit_code = "critical", 3
else:
    status, exit_code = "warning", 2

result = {
    "schemaVersion": 1,
    "status": status,
    "exitCode": exit_code,
    "summary": {
        "total": total,
        "regression": regression,
        "recovery": recovery,
        "oldestAgeHours": age_hours,
        "slaHours": sla_hours,
        "criticalCount": critical_count,
        "slaBreached": sla_breached,
        "countBreached": count_breached,
    },
}
print(json.dumps(result, separators=(",", ":"), ensure_ascii=True))
raise SystemExit(exit_code)
PY
