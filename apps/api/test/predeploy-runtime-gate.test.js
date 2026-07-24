import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const gatePath = new URL('../../../scripts/predeploy-runtime-gate.sh', import.meta.url);
const backupPath = new URL('../../../scripts/backup-postgres.sh', import.meta.url);
const runbookPath = new URL('../../../docs/PREDEPLOY_RUNTIME_CONFIG_GATE.md', import.meta.url);

test('runtime gate fails closed without exposing production values', async () => {
  const source = await readFile(gatePath, 'utf8');
  assert.match(source, /audit-runtime-config\.sh/);
  assert.match(source, /0\|2\)/);
  assert.match(source, /deployment is blocked/);
  assert.match(source, /\.partial/);
  assert.match(source, /chmod 600/);
  assert.doesNotMatch(source, /cat\s+["']?\$ENV_FILE/);
  assert.doesNotMatch(source, /set\s+-x/);
});

test('verified PostgreSQL backup cannot start before the runtime gate passes', async () => {
  const source = await readFile(backupPath, 'utf8');
  const gatePosition = source.indexOf('bash "$RUNTIME_GATE_SCRIPT"');
  const postgresPosition = source.indexOf('docker compose -f "$COMPOSE_FILE" ps');
  const dumpPosition = source.indexOf('pg_dump');
  assert.ok(gatePosition > 0, 'runtime gate invocation is required');
  assert.ok(postgresPosition > gatePosition, 'container inspection must happen after the gate');
  assert.ok(dumpPosition > postgresPosition, 'database dump must happen after the gate');
});

test('runbook documents warning and blocking behavior', async () => {
  const source = await readFile(runbookPath, 'utf8');
  assert.match(source, /warnings do not block/i);
  assert.match(source, /critical findings block/i);
  assert.match(source, /last-runtime-config-audit\.json/);
  assert.match(source, /initial deployment/i);
});
