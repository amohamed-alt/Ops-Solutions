#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${OPS_DEPLOY_PATH:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${OPS_ENV_FILE:-${ROOT_DIR}/.env}"
OUTPUT_FILE="${RUNTIME_AUDIT_OUTPUT_FILE:-${ROOT_DIR}/.deploy-backups/last-runtime-config-audit.json}"
AUDIT_SCRIPT="${ROOT_DIR}/scripts/audit-runtime-config.sh"

usage() {
  cat <<'EOF'
Usage: scripts/predeploy-runtime-gate.sh

Runs the production runtime configuration audit before a deployment-changing operation.
Warnings are recorded but do not block deployment. Critical findings and audit failures block deployment.
No configuration values are printed or persisted.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi
if [[ $# -gt 0 ]]; then
  echo "This command does not accept positional arguments." >&2
  usage >&2
  exit 4
fi

[[ -x "$AUDIT_SCRIPT" || -f "$AUDIT_SCRIPT" ]] || {
  echo "Runtime configuration audit script is missing." >&2
  exit 4
}
[[ -f "$ENV_FILE" ]] || {
  echo "Production runtime configuration file is missing." >&2
  exit 3
}

mkdir -p "$(dirname "$OUTPUT_FILE")"
umask 077
partial_output="${OUTPUT_FILE}.partial"
rm -f "$partial_output"

set +e
OPS_DEPLOY_PATH="$ROOT_DIR" OPS_ENV_FILE="$ENV_FILE" bash "$AUDIT_SCRIPT" json >"$partial_output"
audit_status=$?
set -e

case "$audit_status" in
  0|2)
    mv "$partial_output" "$OUTPUT_FILE"
    chmod 600 "$OUTPUT_FILE"
    if [[ "$audit_status" -eq 2 ]]; then
      echo "Runtime configuration audit completed with non-blocking warnings."
    else
      echo "Runtime configuration audit passed."
    fi
    ;;
  3)
    rm -f "$partial_output"
    echo "Runtime configuration audit found critical production configuration issues; deployment is blocked." >&2
    exit 3
    ;;
  *)
    rm -f "$partial_output"
    echo "Runtime configuration audit could not complete safely; deployment is blocked." >&2
    exit 4
    ;;
esac
