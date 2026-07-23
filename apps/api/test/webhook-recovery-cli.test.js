import assert from 'node:assert/strict';
import test from 'node:test';

import {
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
    dryRun: true
  });
});

test('rejects unsafe recovery arguments', () => {
  assert.throws(() => parseWebhookRecoveryArguments(['--action', 'retry']), /workspace UUID/);
  assert.throws(() => parseWebhookRecoveryArguments(['--action', 'delete', '--workspace', WORKSPACE_ID]), /Action must/);
  assert.throws(() => parseWebhookRecoveryArguments(['--action', 'list', '--workspace', WORKSPACE_ID, '--limit', '500']), /between 1 and 100/);
  assert.throws(() => parseWebhookRecoveryArguments(['--action', 'ignore', '--workspace', WORKSPACE_ID]), /requires at least one/);
});

test('escalates deletion and association recovery to full reconciliation', () => {
  assert.equal(recoveryModeForEvents([{ action: 'changed' }, { action: 'created' }]), 'incremental');
  assert.equal(recoveryModeForEvents([{ action: 'changed' }, { action: 'deleted' }]), 'full');
  assert.equal(recoveryModeForEvents([{ action: 'association_changed' }]), 'full');
});
