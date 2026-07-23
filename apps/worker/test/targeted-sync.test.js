import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
process.env.REDIS_URL ||= 'redis://localhost:6379';

const {
  claimWebhookEvents,
  ensureTargetedWebhookSchema
} = await import('../src/targeted-sync.js');

const WORKSPACE_ID = '5839ad18-0d29-4e1b-aa51-47a0b9756aad';

test('extends webhook event states for durable targeted processing', async () => {
  const queries = [];
  const postgres = {
    async query(text) {
      queries.push(text);
      return { rows: [], rowCount: 0 };
    }
  };

  await ensureTargetedWebhookSchema(postgres);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /DROP CONSTRAINT IF EXISTS hubspot_webhook_events_status_check/);
  assert.match(queries[0], /'processing'/);
  assert.match(queries[0], /'completed'/);
  assert.match(queries[0], /hubspot_webhook_events_processing_idx/);
});

test('claims only scoped queued or failed events with a bounded batch', async () => {
  let captured;
  const postgres = {
    async query(text, values) {
      captured = { text, values };
      return {
        rows: [{
          id: '35fc3b20-90d7-4d26-9ad1-23e8c02572c1',
          object_type: 'contacts',
          object_id: '123',
          action: 'changed'
        }]
      };
    }
  };

  const rows = await claimWebhookEvents(postgres, WORKSPACE_ID, 5_000);
  assert.equal(rows.length, 1);
  assert.deepEqual(captured.values, [WORKSPACE_ID, 500]);
  assert.match(captured.text, /workspace_id = \$1/);
  assert.match(captured.text, /status IN \('queued', 'failed'\)/);
  assert.match(captured.text, /FOR UPDATE SKIP LOCKED/);
  assert.match(captured.text, /SET status = 'processing'/);
});

test('worker routes webhook-sourced jobs to targeted synchronization', async () => {
  const source = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
  assert.match(source, /job\.data\?\.source === 'hubspot_webhook'/);
  assert.match(source, /syncWebhookEvents\(postgres, workspaceId\)/);
  assert.match(source, /targetedWebhookSync: true/);
});
