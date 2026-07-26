import assert from 'node:assert/strict';
import test from 'node:test';

import { isTransientAuditFailure } from './npm-audit-with-retry.mjs';

test('classifies registry transport failures as retryable', () => {
  const samples = [
    'npm error audit endpoint returned an error',
    'npm warn audit invalid json response body at https://registry.npmjs.org/',
    'Unexpected token in JSON at position 0 is not valid JSON',
    'request failed with EAI_AGAIN',
    'socket hang up ECONNRESET',
    'network timeout ETIMEDOUT',
    'request failed with status code 429',
    'request failed with status code 503',
  ];

  for (const sample of samples) {
    assert.equal(isTransientAuditFailure(sample), true, sample);
  }
});

test('does not retry real vulnerability findings or unrelated command failures', () => {
  const samples = [
    '3 critical severity vulnerabilities',
    'Run npm audit fix to address issues',
    'npm ERR! missing script: audit',
    'package-lock.json is invalid',
  ];

  for (const sample of samples) {
    assert.equal(isTransientAuditFailure(sample), false, sample);
  }
});
