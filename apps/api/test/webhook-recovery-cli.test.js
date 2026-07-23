import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyFleetWorkspace,
  parseWebhookRecoveryArguments,
  recoveryModeForEvents
} from '../src/webhook-recovery-cli.js';

const WORKSPACE_ID = '5839ad18-0d29-4e1b-aa51-47a0b9756aad';
const EVENT_ID = '35fc3b20-90d7-4d26-9ad1-23e8c02572c1';

test('parses bounded workspace-scoped recovery arguments', () => {
  assert.deepEqual(parseWebhookRecoveryArguments([
    '--action', 'retry',
    '--workspace', WORKSPACE_ID,
    '--event', EVENT_ID,
    '--event', EVENT_ID,
    '--limit', '25',
    '--dry-run'
  ]), {
    action: 'retry',
    workspaceId: WORKSPACE_ID,
    status: '',
    limit: 25,
    eventIds: [EVENT_ID],
    dryRun: true,
    staleHours: 24,
    onlyUnhealthy: false
  });
});

test('parses read-only fleet health arguments without a workspace', () => {
  assert.deepEqual(parseWebhookRecoveryArguments([
    '--action', 'fleet',
    '--only-unhealthy',
    '--stale-hours', '12'
  ]), {
    action: 'fleet',
    workspaceId: '',
    status: '',
    limit: 50,
    eventIds: [],
    dryRun: false,
    staleHours: 12,
    onlyUnhealthy: true
  });
});

test('rejects unsafe recovery arguments', () => {
  assert.throws(() => parseWebhookRecoveryArguments(['--action', 'retry']), /workspace UUID/);
  assert.throws(() => parseWebhookRecoveryArguments(['--action', 'delete', '--workspace', WORKSPACE_ID]), /Action must/);
  assert.throws(() => parseWebhookRecoveryArguments(['--action', 'list', '--workspace', WORKSPACE_ID, '--limit', '500']), /between 1 and 100/);
  assert.throws(() => parseWebhookRecoveryArguments(['--action', 'ignore', '--workspace', WORKSPACE_ID]), /requires at least one/);
  assert.throws(() => parseWebhookRecoveryArguments(['--action', 'fleet', '--workspace', WORKSPACE_ID]), /does not accept/);
  assert.throws(() => parseWebhookRecoveryArguments(['--action', 'fleet', '--stale-hours', '0']), /between 1 and 720/);
});

test('escalates deletion and association recovery to full reconciliation', () => {
  assert.equal(recoveryModeForEvents([{ action: 'changed' }, { action: 'created' }]), 'incremental');
  assert.equal(recoveryModeForEvents([{ action: 'changed' }, { action: 'deleted' }]), 'full');
  assert.equal(recoveryModeForEvents([{ action: 'association_changed' }]), 'full');
});

test('classifies fleet workspace health by production priority', () => {
  const now = Date.parse('2026-07-23T01:00:00Z');
  const base = {
    workspace_id: WORKSPACE_ID,
    workspace_name: 'Acme',
    portal_id: '123',
    hubspot_status: 'connected',
    total: 10,
    failed: 0,
    pending: 0,
    queued: 10,
    ignored: 0,
    latest_received_at: '2026-07-23T00:30:00Z',
    latest_processed_at: '2026-07-23T00:31:00Z',
    latest_sync_at: '2026-07-23T00:40:00Z'
  };

  assert.equal(classifyFleetWorkspace(base, { now, staleHours: 24 }).health, 'healthy');
  assert.equal(classifyFleetWorkspace({ ...base, hubspot_status: 'error' }, { now }).health, 'disconnected');
  assert.equal(classifyFleetWorkspace({ ...base, failed: 2 }, { now }).health, 'degraded');
  assert.equal(classifyFleetWorkspace({ ...base, pending: 3 }, { now }).health, 'pending');
  assert.equal(classifyFleetWorkspace({ ...base, latest_sync_at: '2026-07-20T00:00:00Z' }, { now, staleHours: 24 }).health, 'stale');
  assert.equal(classifyFleetWorkspace({ ...base, latest_received_at: null }, { now }).health, 'no_webhooks');
});
