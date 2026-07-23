import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const runnerPath = new URL('../../../scripts/run-ops-monitoring-check.sh', import.meta.url);
const installerPath = new URL('../../../scripts/install-ops-monitoring.sh', import.meta.url);
const statusPath = new URL('../../../scripts/ops-monitoring-status.sh', import.meta.url);
const docsPath = new URL('../../../docs/PRODUCTION_MONITORING_SCHEDULER.md', import.meta.url);

test('monitoring runner uses locking, atomic state and bounded history', async () => {
  const source = await readFile(runnerPath, 'utf8');
  assert.match(source, /flock -n/);
  assert.match(source, /os\.replace\(tmp_name, latest\)/);
  assert.match(source, /len\(lines\) > 500/);
  assert.match(source, /check-backup-freshness\.sh/);
  assert.match(source, /data-sla-monitor\.sh/);
  assert.match(source, /audit-tenant-integrity\.sh/);
  assert.doesNotMatch(source, /printenv|env\s*>|DATABASE_URL=.*echo/);
});

test('systemd installer uses persistent randomized timers and service hardening', async () => {
  const source = await readFile(installerPath, 'utf8');
  assert.match(source, /Persistent=true/);
  assert.match(source, /RandomizedDelaySec=/);
  assert.match(source, /NoNewPrivileges=true/);
  assert.match(source, /ProtectSystem=strict/);
  assert.match(source, /ReadWritePaths=/);
  assert.match(source, /systemctl enable --now/);
  assert.doesNotMatch(source, /curl\s+.*token|Authorization:/i);
});

test('status reader exposes only sanitized operational metadata', async () => {
  const source = await readFile(statusPath, 'utf8');
  assert.match(source, /'check', 'status', 'exitCode', 'startedAt', 'completedAt', 'error'/);
  assert.doesNotMatch(source, /result['"]?\s*:/);
  assert.doesNotMatch(source, /token|password|artifact|properties/i);
});

test('runbook documents installation, rollback and state retention', async () => {
  const source = await readFile(docsPath, 'utf8');
  assert.match(source, /install-ops-monitoring\.sh/);
  assert.match(source, /systemctl disable --now/);
  assert.match(source, /500/);
  assert.match(source, /No secrets/i);
});
