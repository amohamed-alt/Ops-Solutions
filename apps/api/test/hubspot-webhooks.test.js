import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  ensureHubSpotWebhookSchema,
  getHubSpotWebhookRollbackSql,
  normalizeHubSpotWebhookEvent,
  validateHubSpotV3Signature
} from '../src/sync-operations.js';

test('validates HubSpot v3 signatures and rejects stale or changed requests', () => {
  const clientSecret = 'test-client-secret';
  const method = 'POST';
  const uri = 'https://ops.example.com/api/v1/hubspot/webhooks';
  const body = '[{"eventId":1,"portalId":123,"objectId":456,"subscriptionType":"contact.creation"}]';
  const timestamp = '1784760000000';
  const signature = createHmac('sha256', clientSecret)
    .update(`${method}${uri}${body}${timestamp}`, 'utf8')
    .digest('base64');

  assert.equal(validateHubSpotV3Signature({
    clientSecret, method, uri, body, timestamp, signature, now: Number(timestamp) + 1000
  }), true);
  assert.equal(validateHubSpotV3Signature({
    clientSecret, method, uri, body: `${body} `, timestamp, signature, now: Number(timestamp) + 1000
  }), false);
  assert.equal(validateHubSpotV3Signature({
    clientSecret, method, uri, body, timestamp, signature, now: Number(timestamp) + 301_000
  }), false);
});

test('decodes only HubSpot signature URI characters before hashing', () => {
  const clientSecret = 'secret';
  const timestamp = '1784760000000';
  const encodedUri = 'https%3A%2F%2Fops.example.com%2Fapi%2Fv1%2Fhubspot%2Fwebhooks';
  const decodedUri = 'https://ops.example.com/api/v1/hubspot/webhooks';
  const body = '[]';
  const signature = createHmac('sha256', clientSecret)
    .update(`POST${decodedUri}${body}${timestamp}`, 'utf8')
    .digest('base64');
  assert.equal(validateHubSpotV3Signature({
    clientSecret,
    method: 'POST',
    uri: encodedUri,
    body,
    timestamp,
    signature,
    now: Number(timestamp)
  }), true);
});

test('normalizes creation, deletion, association, and property events', () => {
  const created = normalizeHubSpotWebhookEvent({
    eventId: 1,
    portalId: 123,
    objectId: 456,
    occurredAt: 1784760000000,
    subscriptionType: 'contact.creation'
  });
  assert.equal(created.objectType, 'contacts');
  assert.equal(created.action, 'created');
  assert.equal(created.eventKey, '1');

  const deleted = normalizeHubSpotWebhookEvent({
    portalId: 123,
    objectId: 789,
    occurredAt: 1784760001000,
    subscriptionType: 'deal.deletion'
  });
  assert.equal(deleted.objectType, 'deals');
  assert.equal(deleted.action, 'deleted');
  assert.equal(deleted.eventKey.length, 64);

  const association = normalizeHubSpotWebhookEvent({
    portalId: 123,
    objectId: 789,
    occurredAt: 1784760002000,
    subscriptionType: 'company.associationChange'
  });
  assert.equal(association.objectType, 'companies');
  assert.equal(association.action, 'association_changed');

  const property = normalizeHubSpotWebhookEvent({
    portalId: 123,
    objectId: 789,
    occurredAt: 1784760003000,
    subscriptionType: 'contact.propertyChange',
    propertyName: 'lifecyclestage'
  });
  assert.equal(property.action, 'changed');
  assert.equal(property.propertyName, 'lifecyclestage');
});

test('rejects malformed webhook events', () => {
  assert.throws(() => normalizeHubSpotWebhookEvent(null), /JSON objects/);
  assert.throws(() => normalizeHubSpotWebhookEvent({ portalId: 123 }), /portalId, objectId, and subscriptionType/);
});

test('creates an idempotent scoped webhook journal and documents rollback', async () => {
  const queries = [];
  const postgres = {
    async query(text) {
      queries.push(text);
      return { rows: [], rowCount: 0 };
    }
  };
  await ensureHubSpotWebhookSchema(postgres);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /CREATE TABLE IF NOT EXISTS hubspot_webhook_events/);
  assert.match(queries[0], /workspace_id UUID REFERENCES workspaces/);
  assert.match(queries[0], /event_key TEXT NOT NULL UNIQUE/);
  assert.match(queries[0], /WHERE status IN \('received', 'failed'\)/);
  assert.match(getHubSpotWebhookRollbackSql(), /DROP TABLE IF EXISTS hubspot_webhook_events/);
});
