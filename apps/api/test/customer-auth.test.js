import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hashPassword,
  hasWorkspaceRole,
  normalizeEmail,
  normalizeWorkspaceRole,
  sanitizeReturnPath,
  slugifyWorkspace,
  validatePassword,
  verifyPassword
} from '../src/customer-auth.js';

test('normalizes customer identity inputs safely', () => {
  assert.equal(normalizeEmail('  Owner@Example.COM '), 'owner@example.com');
  assert.equal(slugifyWorkspace(' ACME Gulf & North Africa '), 'acme-gulf-north-africa');
});

test('requires production-grade customer passwords', () => {
  assert.equal(validatePassword('short'), false);
  assert.equal(validatePassword('long-enough-password'), true);
});

test('hashes and verifies passwords without storing plaintext', async () => {
  const encoded = await hashPassword('a-very-strong-password');
  assert.match(encoded, /^scrypt-v1\./);
  assert.equal(encoded.includes('a-very-strong-password'), false);
  assert.equal(await verifyPassword('a-very-strong-password', encoded), true);
  assert.equal(await verifyPassword('wrong-password', encoded), false);
});

test('allows only same-origin OAuth return paths', () => {
  assert.equal(sanitizeReturnPath('/onboarding?step=scan'), '/onboarding?step=scan');
  assert.equal(sanitizeReturnPath('https://evil.example/path'), '/onboarding');
  assert.equal(sanitizeReturnPath('//evil.example/path'), '/onboarding');
  assert.equal(sanitizeReturnPath('/\\evil'), '/onboarding');
});

test('normalizes supported workspace roles and applies least privilege', () => {
  assert.equal(normalizeWorkspaceRole(' ADMIN '), 'admin');
  assert.equal(normalizeWorkspaceRole('unsupported'), 'viewer');
  assert.equal(normalizeWorkspaceRole('unsupported', ''), '');
});

test('enforces the owner, admin, viewer role hierarchy', () => {
  assert.equal(hasWorkspaceRole('owner', 'owner'), true);
  assert.equal(hasWorkspaceRole('owner', 'admin'), true);
  assert.equal(hasWorkspaceRole('admin', 'viewer'), true);
  assert.equal(hasWorkspaceRole('admin', 'owner'), false);
  assert.equal(hasWorkspaceRole('viewer', 'admin'), false);
  assert.equal(hasWorkspaceRole('unknown', 'viewer'), false);
});
