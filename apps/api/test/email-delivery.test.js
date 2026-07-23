import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EMAIL_DELIVERY_ROLLBACK_SQL,
  buildScheduledReportMessage,
  classifyDeliveryError,
  getEmailDeliveryConfiguration,
  retryDelayMs,
  sendEmail
} from '../src/email-delivery.js';

test('email delivery is disabled safely until a provider is configured', () => {
  const config = getEmailDeliveryConfiguration({ EMAIL_PROVIDER: 'disabled' });
  assert.equal(config.configured, false);
  assert.equal(config.provider, 'disabled');
  assert.ok(config.missing.includes('EMAIL_PROVIDER'));
});

test('recognizes complete Resend and Postmark configurations without exposing keys', () => {
  const resend = getEmailDeliveryConfiguration({
    EMAIL_PROVIDER: 'resend', EMAIL_FROM_ADDRESS: 'reports@example.com', RESEND_API_KEY: 'secret-value'
  });
  assert.equal(resend.configured, true);
  assert.equal(resend.provider, 'resend');
  const postmark = getEmailDeliveryConfiguration({
    EMAIL_PROVIDER: 'postmark', EMAIL_FROM_ADDRESS: 'reports@example.com', POSTMARK_SERVER_TOKEN: 'secret-value'
  });
  assert.equal(postmark.configured, true);
  assert.equal(postmark.provider, 'postmark');
});

test('classifies transient provider failures for retry and permanent rejections for failure', () => {
  assert.equal(classifyDeliveryError(429, 'rate limited').retryable, true);
  assert.equal(classifyDeliveryError(503, 'unavailable').retryable, true);
  assert.equal(classifyDeliveryError(422, 'invalid sender').retryable, false);
  assert.equal(retryDelayMs(1), 5 * 60_000);
  assert.equal(retryDelayMs(5), 80 * 60_000);
});

test('builds an escaped report message with a tenant-specific settings link', () => {
  const message = buildScheduledReportMessage({
    workspace_id: 'workspace-id',
    workspace_name: '<Acme>',
    view_name: 'Leadership & Revenue',
    filters: { from: '2026-07-01', to: '2026-07-31' },
    delivery_mode: 'attachment',
    export_completed_at: '2026-07-23T06:00:00.000Z'
  }, 'https://ops.example.com');
  assert.match(message.subject, /<Acme>/);
  assert.match(message.html, /&lt;Acme&gt;/);
  assert.doesNotMatch(message.html, /<Acme>/);
  assert.match(message.text, /settings\/reports\?workspaceId=workspace-id/);
});

test('Resend adapter sends a stable idempotency key and base64 attachment', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ id: 'message-1' }), { status: 200 });
  };
  const result = await sendEmail({
    configured: true, provider: 'resend', apiKey: 'secret', fromEmail: 'reports@example.com', fromName: 'Ops'
  }, {
    recipients: ['person@example.com'], subject: 'Report', text: 'Text', html: '<p>Text</p>',
    idempotencyKey: 'scheduled-report-1',
    attachment: { fileName: 'report.csv', contentType: 'text/csv', content: Buffer.from('safe') }
  }, fetchImpl);
  assert.equal(result.providerMessageId, 'message-1');
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.options.headers['idempotency-key'], 'scheduled-report-1');
  const body = JSON.parse(request.options.body);
  assert.equal(body.attachments[0].content, Buffer.from('safe').toString('base64'));
});

test('Postmark adapter carries execution metadata and does not retry permanent rejection', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return new Response('invalid sender', { status: 422 });
  };
  await assert.rejects(() => sendEmail({
    configured: true, provider: 'postmark', apiKey: 'secret', fromEmail: 'reports@example.com', fromName: 'Ops'
  }, {
    recipients: ['person@example.com'], subject: 'Report', text: 'Text', html: '<p>Text</p>',
    idempotencyKey: 'scheduled-report-2', attachment: null
  }, fetchImpl), (error) => error.retryable === false && error.category === 'permanent_provider_rejection');
  assert.equal(request.url, 'https://api.postmarkapp.com/email');
  assert.equal(JSON.parse(request.options.body).Metadata.execution_id, 'scheduled-report-2');
});

test('delivery migration documents a reversible schema change', () => {
  assert.match(EMAIL_DELIVERY_ROLLBACK_SQL, /DROP COLUMN IF EXISTS delivery_attempt_count/);
  assert.match(EMAIL_DELIVERY_ROLLBACK_SQL, /DROP INDEX IF EXISTS scheduled_report_executions_delivery_due_idx/);
});
