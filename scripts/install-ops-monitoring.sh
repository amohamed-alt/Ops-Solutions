#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_PATH="${OPS_DEPLOY_PATH:-/root/Ops-Solutions}"
STATE_DIR="${OPS_MONITORING_STATE_DIR:-/var/lib/ops-solutions/monitoring}"
UNIT_DIR="${OPS_SYSTEMD_UNIT_DIR:-/etc/systemd/system}"

[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "Run as root" >&2; exit 4; }
[[ "$DEPLOY_PATH" = /* && -d "$DEPLOY_PATH" ]] || { echo "OPS_DEPLOY_PATH must be an existing absolute path" >&2; exit 4; }
[[ "$STATE_DIR" = /* ]] || { echo "OPS_MONITORING_STATE_DIR must be absolute" >&2; exit 4; }
[[ "$UNIT_DIR" = /* ]] || { echo "OPS_SYSTEMD_UNIT_DIR must be absolute" >&2; exit 4; }
command -v systemctl >/dev/null 2>&1 || { echo "systemctl is required" >&2; exit 4; }

install -d -m 0750 "$STATE_DIR"
install -d -m 0755 "$UNIT_DIR"
install -m 0755 "$DEPLOY_PATH/scripts/run-ops-monitoring-check.sh" "$DEPLOY_PATH/scripts/run-ops-monitoring-check.sh"

cat >"$UNIT_DIR/ops-solutions-monitor@.service" <<EOF
[Unit]
Description=Ops Solutions production monitoring check (%i)
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$DEPLOY_PATH
Environment=OPS_DEPLOY_PATH=$DEPLOY_PATH
Environment=OPS_MONITORING_STATE_DIR=$STATE_DIR
ExecStart=$DEPLOY_PATH/scripts/run-ops-monitoring-check.sh %i
User=root
Group=root
UMask=0027
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=read-only
ProtectSystem=strict
ReadWritePaths=$STATE_DIR /run/lock $DEPLOY_PATH/backups $DEPLOY_PATH/.deploy-backups
TimeoutStartSec=30min
StandardOutput=journal
StandardError=journal
EOF

write_timer() {
  local name="$1" calendar="$2" delay="$3"
  cat >"$UNIT_DIR/ops-solutions-monitor-${name}.timer" <<EOF
[Unit]
Description=Schedule Ops Solutions ${name} monitoring

[Timer]
OnCalendar=${calendar}
Persistent=true
RandomizedDelaySec=${delay}
Unit=ops-solutions-monitor@${name}.service

[Install]
WantedBy=timers.target
EOF
}

write_timer backup '*-*-* 04:20:00' '15m'
write_timer sla '*:07:00' '3m'
write_timer integrity '*-*-* 05:10:00' '20m'

systemctl daemon-reload
systemctl enable --now ops-solutions-monitor-backup.timer ops-solutions-monitor-sla.timer ops-solutions-monitor-integrity.timer

echo "Installed Ops Solutions monitoring timers"
systemctl --no-pager list-timers 'ops-solutions-monitor-*' || true
