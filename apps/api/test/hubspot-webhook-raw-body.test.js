import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  captureRawHubSpotWebhookBody,
  rawHubSpotWebhookBody,
  validateHubSpotV3Signature
} from '../src/sync-operations-base.js';

function captureBody(chunks) {
  const request = {};
  return new Promise((resolve, reject) => {
    captureRawHubSpotWebhookBody(request, null, Readable.from(chunks), (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      stream.on('error', reject);
      stream.on('data', () => undefined);
      stream.on('end', () => resolve({ request, stream }));
    });
  });
}

test('captures the exact webhook bytes while leaving the payload readable by Fastify', async () => {
  const raw = '[ {"portalId":123, "objectId":"42", "subscriptionType":"contact.propertyChange"} ]';
  const first = Buffer.from(raw.slice(0, 27));
  const second = Buffer.from(raw.slice(27));

  const { request, stream } = await captureBody([first, second]);

  assert.equal(rawHubSpotWebhookBody(request), raw);
  assert.equal(stream.receivedEncodedLength, Buffer.byteLength(raw));
});

test('signature validation uses raw whitespace and key order rather than re-serialized JSON', () => {
  const clientSecret = 'test-client-secret';
  const method = 'POST';
  const uri = 'https://example.test/api/v1/hubspot/webhooks';
  const timestamp = '1770000000000';
  const rawBody = '[ {"portalId":123, "objectId":"42"} ]';
  const reserializedBody = JSON.stringify(JSON.parse(rawBody));
  const signature = createHmac('sha256', clientSecret)
    .update(`${method}${uri}${rawBody}${timestamp}`, 'utf8')
    .digest('base64');

  assert.notEqual(rawBody, reserializedBody);
  assert.equal(validateHubSpotV3Signature({
    clientSecret,
    method,
    uri,
    body: rawBody,
    timestamp,
    signature,
    now: Number(timestamp)
  }), true);
  assert.equal(validateHubSpotV3Signature({
    clientSecret,
    method,
    uri,
    body: reserializedBody,
    timestamp,
    signature,
    now: Number(timestamp)
  }), false);
});

test('fails closed when the raw request body was not captured', () => {
  assert.throws(
    () => rawHubSpotWebhookBody({}),
    (error) => error?.category === 'RAW_WEBHOOK_BODY_UNAVAILABLE' && error?.statusCode === 400
  );
});
