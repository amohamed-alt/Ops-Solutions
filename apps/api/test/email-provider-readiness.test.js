import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateEmailProviderReadiness,
  serializeEmailProviderReadiness
} from '../src/email-provider-readiness.js';

test('disabled provider reports configuration required without exposing values', () => {
  const result = evaluateEmailProviderReadiness({
    EMAIL_PROVIDER: 'disabled',
    EMAIL_FROM_ADDRESS: '',
    RESEND_API_KEY: 'secret-value-that-must-not-leak'
  });

  assert.equal(result.configured, false);
  assert.equal(result.status, 'configuration_required');
  assert.deepEqual(result.missing, ['EMAIL_PROVIDER', 'EMAIL_FROM_ADDRESS']);
  assert.equal(result.capabilities.transactionalEmail, false);
  assert.doesNotMatch(JSON.stringify(result), /secret-value-that-must-not-leak/);
});

test('resend readiness exposes only safe provider metadata', () => {
  const result = evaluateEmailProviderReadiness({
    EMAIL_PROVIDER: 'resend',
    EMAIL_FROM_ADDRESS: 'reports@example.com',
    EMAIL_FROM_NAME: 'Ops Reports',
    RESEND_API_KEY: 're_secret_value'
  });

  assert.equal(result.configured, true);
  assert.equal(result.status, 'ready');
  assert.equal(result.provider, 'resend');
  assert.equal(result.from.addressDomain, 'example.com');
  assert.equal(result.from.nameConfigured, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.invalid, []);
  assert.equal(result.capabilities.scheduledReports, true);
  assert.doesNotMatch(JSON.stringify(result), /reports@example\.com|re_secret_value/);
});

test('postmark requires its server token and validates sender address', () => {
  const result = evaluateEmailProviderReadiness({
    EMAIL_PROVIDER: 'postmark',
    EMAIL_FROM_ADDRESS: 'not-an-email'
  });

  assert.equal(result.configured, false);
  assert.equal(result.status, 'invalid_configuration');
  assert.deepEqual(result.missing, ['POSTMARK_SERVER_TOKEN']);
  assert.deepEqual(result.invalid, ['EMAIL_FROM_ADDRESS']);
  assert.equal(result.from.addressDomain, null);
});

test('unsupported provider fails closed', () => {
  const result = evaluateEmailProviderReadiness({
    EMAIL_PROVIDER: 'smtp',
    EMAIL_FROM_ADDRESS: 'reports@example.com'
  });

  assert.equal(result.configured, false);
  assert.equal(result.provider, 'unsupported');
  assert.deepEqual(result.invalid, ['EMAIL_PROVIDER']);
});

test('serialized output never includes provider credentials or sender local-part', () => {
  const output = serializeEmailProviderReadiness({
    EMAIL_PROVIDER: 'resend',
    EMAIL_FROM_ADDRESS: 'private.sender@example.com',
    RESEND_API_KEY: 'top-secret-key'
  });

  assert.match(output, /"status": "ready"/);
  assert.match(output, /"addressDomain": "example.com"/);
  assert.doesNotMatch(output, /private\.sender|top-secret-key/);
});
