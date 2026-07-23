#!/usr/bin/env bash
set -Eeuo pipefail

STATE_DIR="${OPS_MONITORING_STATE_DIR:-/var/lib/ops-solutions/monitoring}"
FORMAT="${1:-text}"
[[ "$FORMAT" =~ ^(text|json)$ ]] || { echo "Usage: $0 [text|json]" >&2; exit 4; }
[[ "$STATE_DIR" = /* ]] || { echo "OPS_MONITORING_STATE_DIR must be absolute" >&2; exit 4; }

python3 - "$STATE_DIR" "$FORMAT" <<'PY'
import json, pathlib, sys
state_dir = pathlib.Path(sys.argv[1])
fmt = sys.argv[2]
checks = []
severity = 0
for name in ('backup', 'sla', 'integrity'):
    path = state_dir / f'{name}-latest.json'
    if not path.exists():
        item = {'check': name, 'status': 'missing', 'exitCode': 3, 'completedAt': None}
    else:
        try:
            row = json.loads(path.read_text())
            item = {key: row.get(key) for key in ('check', 'status', 'exitCode', 'startedAt', 'completedAt', 'error')}
        except Exception:
            item = {'check': name, 'status': 'corrupt', 'exitCode': 3, 'completedAt': None}
    code = int(item.get('exitCode') or 0)
    severity = max(severity, 3 if code >= 3 else (2 if code == 2 else 0))
    checks.append(item)
summary = {'schemaVersion': 1, 'status': 'critical' if severity == 3 else ('warning' if severity == 2 else 'healthy'), 'checks': checks}
if fmt == 'json':
    print(json.dumps(summary, separators=(',', ':'), ensure_ascii=True))
else:
    print(f"Ops Solutions monitoring: {summary['status']}")
    for item in checks:
        print(f"- {item['check']}: {item['status']} (exit={item['exitCode']}, completed={item.get('completedAt') or 'never'})")
sys.exit(severity)
PY
