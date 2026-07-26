import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateRuntimeConfig } from '../../../scripts/runtime-config-audit.mjs';

function parsed(values, duplicates = [], invalidLines = []) {
  return { values: new Map(Object.entries(values)), duplicates, invalidLines };
}

const template = parsed({
  NODE_ENV: 'production',
  APP_URL: 'https://ops.example.com',
  DATABASE_URL: 'postgresql://user:pass@postgres:5432/ops',
  REDIS_URL: 'redis://redis:6379',
  ADMIN_API_KEY: 'replace-me',
  ENCRYPTION_KEY: 'replace-me'
});
const composeKeys = new Set(['NODE_ENV', 'APP_URL', 'DATABASE_URL', 'REDIS_URL', 'ADMIN_API_KEY', 'ENCRYPTION_KEY']);

function healthyEnv() {
  return parsed({
    NODE_ENV: 'production',
    APP_URL: 'https://ops.dashboardtalentera.tech',
    DATABASE_URL: 'postgresql://ops:strong-password@postgres:5432/ops',
    REDIS_URL: 'redis://redis:6379',
    ADMIN_API_KEY: 'a'.repeat(48),
    ENCRYPTION_KEY: 'b'.repeat(64)
  });
}

test('accepts a complete production configuration without exposing values', () => {
  const result = evaluateRuntimeConfig({ env: healthyEnv(), template, composeKeys, mode: 0o600, production: true });
  assert.equal(result.status, 'healthy');
  assert.equal(result.findings.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /strong-password/);
  assert.doesNotMatch(JSON.stringify(result), /a{20}/);
});

test('detects missing, duplicate, placeholder and unsafe production settings', () => {
  const env = parsed({
    NODE_ENV: 'development',
    APP_URL: 'http://ops.example.com',
    DATABASE_URL: '',
    REDIS_URL: 'redis://redis:6379',
    ADMIN_API_KEY: 'changeme',
    DISABLE_AUTH: 'true'
  }, ['REDIS_URL']);
  const result = evaluateRuntimeConfig({ env, template, composeKeys, mode: 0o644, production: true });
  assert.equal(result.status, 'critical');
  const codes = new Set(result.findings.map((item) => item.code));
  assert.ok(codes.has('missing_required_key'));
  assert.ok(codes.has('duplicate_key'));
  assert.ok(codes.has('placeholder_value'));
  assert.ok(codes.has('unsafe_env_permissions'));
  assert.ok(codes.has('invalid_url'));
  assert.ok(codes.has('unsafe_production_flag'));
});

test('warns about undocumented keys and weak sensitive values without printing secrets', () => {
  const env = healthyEnv();
  env.values.set('UNKNOWN_VENDOR_TOKEN', 'short-private-value');
  const result = evaluateRuntimeConfig({ env, template, composeKeys, mode: 0o600, production: true });
  assert.equal(result.status, 'warning');
  assert.ok(result.findings.some((item) => item.code === 'undocumented_key' && item.key === 'UNKNOWN_VENDOR_TOKEN'));
  assert.ok(result.findings.some((item) => item.code === 'short_sensitive_value' && item.key === 'UNKNOWN_VENDOR_TOKEN'));
  assert.doesNotMatch(JSON.stringify(result), /short-private-value/);
});

test('allows non-production policy checks for local development', () => {
  const env = healthyEnv();
  env.values.set('NODE_ENV', 'development');
  const result = evaluateRuntimeConfig({ env, template, composeKeys, mode: 0o600, production: false });
  assert.equal(result.findings.some((item) => item.code === 'unsafe_production_flag'), false);
});

test('allows disabled email and AI integrations to remain unconfigured', () => {
  const integrationTemplate = parsed({
    ...Object.fromEntries(template.values),
    EMAIL_PROVIDER: 'disabled',
    EMAIL_FROM_ADDRESS: '',
    EMAIL_FROM_NAME: 'Ops Intelligence',
    RESEND_API_KEY: '',
    POSTMARK_SERVER_TOKEN: '',
    EMAIL_DELIVERY_POLL_INTERVAL_MS: '60000',
    AI_API_KEY: '',
    AI_MODEL: '',
    ONBOARDING_SESSION_SECRET: '',
    HUBSPOT_OPTIONAL_SCOPES: '',
    RELEASE_SHA: 'unknown',
    RELEASE_DEPLOYED_AT: ''
  });
  const integrationComposeKeys = new Set([...composeKeys, ...integrationTemplate.values.keys()]);
  const env = healthyEnv();
  env.values.set('EMAIL_PROVIDER', 'disabled');
  const result = evaluateRuntimeConfig({ env, template: integrationTemplate, composeKeys: integrationComposeKeys, mode: 0o600, production: true });
  assert.equal(result.status, 'healthy');
  assert.equal(result.findings.length, 0);
});

test('requires provider-specific email configuration only when delivery is enabled', () => {
  const integrationTemplate = parsed({
    ...Object.fromEntries(template.values),
    EMAIL_PROVIDER: 'disabled',
    EMAIL_FROM_ADDRESS: '',
    RESEND_API_KEY: '',
    POSTMARK_SERVER_TOKEN: ''
  });
  const integrationComposeKeys = new Set([...composeKeys, ...integrationTemplate.values.keys()]);
  const env = healthyEnv();
  env.values.set('EMAIL_PROVIDER', 'resend');
  const result = evaluateRuntimeConfig({ env, template: integrationTemplate, composeKeys: integrationComposeKeys, mode: 0o600, production: true });
  assert.equal(result.status, 'critical');
  assert.ok(result.findings.some((item) => item.code === 'missing_required_key' && item.key === 'EMAIL_FROM_ADDRESS'));
  assert.ok(result.findings.some((item) => item.code === 'missing_required_key' && item.key === 'RESEND_API_KEY'));
  assert.equal(result.findings.some((item) => item.key === 'POSTMARK_SERVER_TOKEN'), false);
});
