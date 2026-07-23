#!/usr/bin/env bash
set -Eeuo pipefail

ACTION="${1:-}"
DEPLOY_PATH="${OPS_DEPLOY_PATH:-/root/Ops-Solutions}"
STATE_DIR="${OPS_MONITORING_STATE_DIR:-/var/lib/ops-solutions/monitoring}"
LOCK_DIR="${OPS_MONITORING_LOCK_DIR:-/run/lock}"
MAX_AGE_HOURS="${OPS_BACKUP_MAX_AGE_HOURS:-26}"
STALE_HOURS="${OPS_TENANT_STALE_HOURS:-24}"
LIMIT="${OPS_MONITORING_LIMIT:-100}"

usage() {
  echo "Usage: $0 <backup|sla|integrity>" >&2
  exit 4
}

[[ "$ACTION" =~ ^(backup|sla|integrity)$ ]] || usage
[[ "$DEPLOY_PATH" = /* ]] || { echo "OPS_DEPLOY_PATH must be absolute" >&2; exit 4; }
[[ "$STATE_DIR" = /* ]] || { echo "OPS_MONITORING_STATE_DIR must be absolute" >&2; exit 4; }
[[ "$LOCK_DIR" = /* ]] || { echo "OPS_MONITORING_LOCK_DIR must be absolute" >&2; exit 4; }
[[ "$MAX_AGE_HOURS" =~ ^[0-9]+$ ]] || { echo "OPS_BACKUP_MAX_AGE_HOURS must be numeric" >&2; exit 4; }
[[ "$STALE_HOURS" =~ ^[0-9]+$ ]] || { echo "OPS_TENANT_STALE_HOURS must be numeric" >&2; exit 4; }
[[ "$LIMIT" =~ ^[0-9]+$ ]] || { echo "OPS_MONITORING_LIMIT must be numeric" >&2; exit 4; }

command -v flock >/dev/null 2>&1 || { echo "flock is required" >&2; exit 4; }
command -v python3 >/dev/null 2>&1 || { echo "python3 is required" >&2; exit 4; }
[[ -d "$DEPLOY_PATH" ]] || { echo "Deployment path not found" >&2; exit 4; }

install -d -m 0750 "$STATE_DIR" "$LOCK_DIR"
LOCK_FILE="$LOCK_DIR/ops-solutions-${ACTION}.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another ${ACTION} monitoring check is already running" >&2
  exit 0
fi

started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
output_file="$(mktemp "$STATE_DIR/.${ACTION}.XXXXXX")"
error_file="$(mktemp "$STATE_DIR/.${ACTION}.error.XXXXXX")"
trap 'rm -f "$output_file" "$error_file"' EXIT

cd "$DEPLOY_PATH"
set +e
case "$ACTION" in
  backup)
    bash scripts/check-backup-freshness.sh --max-age-hours "$MAX_AGE_HOURS" --format json >"$output_file" 2>"$error_file"
    exit_code=$?
    ;;
  sla)
    bash scripts/data-sla-monitor.sh --action evaluate --format json >"$output_file" 2>"$error_file"
    exit_code=$?
    ;;
  integrity)
    bash scripts/audit-tenant-integrity.sh --format json --stale-hours "$STALE_HOURS" --limit "$LIMIT" >"$output_file" 2>"$error_file"
    exit_code=$?
    ;;
esac
set -e

completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STATE_DIR="$STATE_DIR" ACTION="$ACTION" STARTED_AT="$started_at" COMPLETED_AT="$completed_at" EXIT_CODE="$exit_code" OUTPUT_FILE="$output_file" ERROR_FILE="$error_file" python3 - <<'PY'
import json, os, pathlib, tempfile
state_dir = pathlib.Path(os.environ['STATE_DIR'])
action = os.environ['ACTION']
raw = pathlib.Path(os.environ['OUTPUT_FILE']).read_text(errors='replace').strip()
err = pathlib.Path(os.environ['ERROR_FILE']).read_text(errors='replace').strip()
try:
    payload = json.loads(raw) if raw else None
except json.JSONDecodeError:
    payload = {'unparsed': raw[:4000]}
record = {
    'schemaVersion': 1,
    'check': action,
    'startedAt': os.environ['STARTED_AT'],
    'completedAt': os.environ['COMPLETED_AT'],
    'exitCode': int(os.environ['EXIT_CODE']),
    'status': 'healthy' if int(os.environ['EXIT_CODE']) == 0 else ('warning' if int(os.environ['EXIT_CODE']) == 2 else 'critical'),
    'result': payload,
    'error': err[:2000] or None,
}
latest = state_dir / f'{action}-latest.json'
history = state_dir / f'{action}-history.jsonl'
fd, tmp_name = tempfile.mkstemp(prefix=f'.{action}-', dir=state_dir)
with os.fdopen(fd, 'w') as handle:
    json.dump(record, handle, separators=(',', ':'), ensure_ascii=True)
    handle.write('\n')
os.chmod(tmp_name, 0o640)
os.replace(tmp_name, latest)
with history.open('a') as handle:
    handle.write(json.dumps(record, separators=(',', ':'), ensure_ascii=True) + '\n')
os.chmod(history, 0o640)
# Keep bounded local history without depending on logrotate.
lines = history.read_text().splitlines()
if len(lines) > 500:
    history.write_text('\n'.join(lines[-500:]) + '\n')
PY

exit "$exit_code"
